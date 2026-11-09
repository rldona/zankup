"""Health data (phase 6): the dashboard, the sources and their order, Google Health and the Android
app's Health Connect uploads. `/api/health` is the service's health check, hence `/api/wellness`.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select

from zankup.api.routing import protected_router
from zankup.auth.deps import AppSettings, CurrentUser, DbSession
from zankup.auth.google import AUTHORIZE_URL, _b64, _origin, _signed_in
from zankup.db.models import HEALTH_SOURCES, DailyHealth, SleepSession, Source, SourcePriority
from zankup.health import google as google_health
from zankup.health import resolve
from zankup.health.store import STAGES, DayIn, SleepIn, Stage, save_day, save_sleep
from zankup.jobs.queue import enqueue

log = logging.getLogger("zankup.wellness")

router = protected_router(prefix="/api/wellness", tags=["health"])
oauth = APIRouter(prefix="/api/wellness/google", tags=["health"])

HealthSource = Literal["garmin", "google_health", "health_connect"]
Metric = Literal["sleep", "resting_hr", "hrv", "spo2", "respiration", "steps"]
COOKIE = "zankup_google_health"
COOKIE_PATH = "/api/wellness/google"
FLOW_TTL = timedelta(minutes=10)
MAX_RANGE = 400


# --- the dashboard -------------------------------------------------------------------------------------


class Night(BaseModel):
    source: HealthSource
    start_utc: datetime
    end_utc: datetime
    utc_offset_s: int | None
    asleep_s: int | None
    awake_s: int | None
    light_s: int | None
    deep_s: int | None
    rem_s: int | None
    score: int | None
    others: list[HealthSource] = Field(description="Other sources that recorded this night")


class Value(BaseModel):
    value: float
    source: HealthSource
    others: list[HealthSource]


class ReadinessOut(BaseModel):
    score: int
    hrv: int | None
    resting_hr: int | None
    sleep: int | None
    form: int | None


class HealthDay(BaseModel):
    day: date
    sleep: Night | None
    resting_hr: Value | None
    hrv: Value | None
    spo2: Value | None
    respiration: Value | None
    steps: Value | None
    tsb: float | None
    readiness: ReadinessOut | None


def _night(s: SleepSession, others: list[str]) -> Night:
    return Night(
        source=s.source,
        start_utc=s.start_utc,
        end_utc=s.end_utc,
        utc_offset_s=s.utc_offset_s,
        asleep_s=s.asleep_s,
        awake_s=s.awake_s,
        light_s=s.light_s,
        deep_s=s.deep_s,
        rem_s=s.rem_s,
        score=s.score,
        others=others,
    )


def _value(day: resolve.Day, metric: str) -> Value | None:
    picked = day.values.get(metric)
    if picked is None:
        return None
    return Value(value=picked.value, source=picked.source, others=picked.others)


@router.get("/days", operation_id="getHealthDays")
def health_days(
    db: DbSession,
    user: CurrentUser,
    start: Annotated[date | None, Query()] = None,
    end: Annotated[date | None, Query(description="Exclusive")] = None,
) -> list[HealthDay]:
    """One row per day with health data, one value per metric chosen between sources (OS-605)."""
    end = end or datetime.now(UTC).date() + timedelta(days=1)
    start = start or end - timedelta(days=90)
    if start >= end or (end - start).days > MAX_RANGE:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Ranges of 1 to {MAX_RANGE} days")
    out = []
    for d in resolve.days(db, user.id, start, end):
        r = d.readiness
        out.append(
            HealthDay(
                day=d.day,
                sleep=_night(d.sleep, d.sleep_others) if d.sleep else None,
                resting_hr=_value(d, "resting_hr"),
                hrv=_value(d, "hrv"),
                spo2=_value(d, "spo2"),
                respiration=_value(d, "respiration"),
                steps=_value(d, "steps"),
                tsb=d.tsb,
                readiness=ReadinessOut(**r.__dict__) if r else None,
            )
        )
    return out


class Stage_(BaseModel):
    offset_s: int
    duration_s: int
    stage: Literal["awake", "light", "deep", "rem"]


class NightDetail(BaseModel):
    day: date
    chosen: Night
    stages: list[Stage_]
    alternatives: list[Night] = Field(description="The same night from the other sources")


@router.get("/nights/{day}", operation_id="getHealthNight")
def night_detail(day: date, db: DbSession, user: CurrentUser) -> NightDetail:
    """A night's stages, and how every source recorded it."""
    order = resolve.priorities(db, user.id)["sleep"]
    all_ = list(
        db.scalars(select(SleepSession).where(SleepSession.user_id == user.id, SleepSession.day == day))
    )
    chosen = resolve.choose_sleep(all_, order)
    if chosen is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No sleep recorded that night")
    rest = [s for s in all_ if s is not chosen and not s.nap]
    return NightDetail(
        day=day,
        chosen=_night(chosen, sorted({s.source for s in rest})),
        stages=[Stage_(offset_s=a, duration_s=b, stage=c) for a, b, c in chosen.stages or []],
        alternatives=[_night(s, []) for s in rest],
    )


# --- sources and their order ---------------------------------------------------------------------------


class HealthSourceStatus(BaseModel):
    source: HealthSource
    available: bool = Field(description="Configured on this instance (Garmin key, Google client…)")
    connected: bool
    needs_reconnect: bool = False
    missing: list[str] = Field(default_factory=list, description="Google scopes the person did not grant")
    last_sync_at: datetime | None
    nights: int
    days: int


class HealthSettings(BaseModel):
    sources: list[HealthSourceStatus]
    priority: dict[Metric, list[HealthSource]] = Field(description="Empty list: the automatic rules")


def _counts(db: DbSession, user_id: int, model: type[SleepSession] | type[DailyHealth]) -> dict[str, int]:
    rows = db.execute(
        select(model.source, func.count()).where(model.user_id == user_id).group_by(model.source)
    ).all()
    return {str(source): int(count) for source, count in rows}


@router.get("/settings", operation_id="getHealthSettings")
def health_settings(db: DbSession, user: CurrentUser, settings: AppSettings) -> HealthSettings:
    nights, days = _counts(db, user.id, SleepSession), _counts(db, user.id, DailyHealth)
    rows = {s.kind: s for s in db.scalars(select(Source).where(Source.user_id == user.id))}
    integrations = settings.integrations()
    out = []
    for kind in HEALTH_SOURCES:
        row = rows.get(kind)
        cursor = (row.sync_cursor or {}) if row else {}
        if kind == "garmin":
            available, connected = integrations["garmin"], integrations["garmin"]
            last = (
                datetime.fromisoformat(cursor["health"]["at"]) if cursor.get("health", {}).get("at") else None
            )
        elif kind == "google_health":
            available, connected = integrations["google_health"], row is not None and row.secret is not None
            last = row.last_sync_at if row else None
        else:
            available, connected = True, row is not None
            last = row.last_sync_at if row else None
        out.append(
            HealthSourceStatus(
                source=kind,
                available=available,
                connected=connected,
                needs_reconnect=bool(cursor.get("reauth")) if kind == "google_health" else False,
                missing=list(cursor.get("missing") or []) if kind == "google_health" else [],
                last_sync_at=last,
                nights=nights.get(kind, 0),
                days=days.get(kind, 0),
            )
        )
    return HealthSettings(sources=out, priority=resolve.priorities(db, user.id))


class PriorityIn(BaseModel):
    priority: dict[Metric, list[HealthSource]]


@router.put("/priority", operation_id="setHealthPriority")
def set_priority(body: PriorityIn, db: DbSession, user: CurrentUser, settings: AppSettings) -> HealthSettings:
    """The order of sources per metric; an empty list goes back to the automatic rules."""
    for metric, sources in body.priority.items():
        unique = list(dict.fromkeys(sources))
        db.execute(
            delete(SourcePriority).where(SourcePriority.user_id == user.id, SourcePriority.metric == metric)
        )
        if unique:
            db.add(SourcePriority(user_id=user.id, metric=metric, sources=unique))
    db.commit()
    return health_settings(db, user, settings)


@router.post("/sync", operation_id="syncHealth", status_code=202)
def sync_now(db: DbSession, user: CurrentUser, settings: AppSettings) -> dict[str, list[str]]:
    """Fetch new health data from every connected source now."""
    queued = []
    minute = datetime.now(UTC).strftime("%Y%m%d%H%M")
    if settings.integrations()["garmin"]:
        enqueue(
            db, "sync_garmin_health", user_id=user.id, dedupe_key=f"sync:garmin_health:{user.id}:{minute}"
        )
        queued.append("garmin")
    row = google_health.source_row(db, user.id)
    if row is not None and settings.integrations()["google_health"]:
        enqueue(
            db, "sync_google_health", user_id=user.id, dedupe_key=f"sync:google_health:{user.id}:{minute}"
        )
        queued.append("google_health")
    db.commit()
    return {"queued": queued}


@router.delete("/sources/{source}/data", operation_id="deleteHealthData", status_code=204)
def delete_data(source: HealthSource, db: DbSession, user: CurrentUser) -> None:
    """Delete every sleep and daily figure from one source. The connection stays, and its next sync
    starts again from the beginning (30 days)."""
    db.execute(delete(SleepSession).where(SleepSession.user_id == user.id, SleepSession.source == source))
    db.execute(delete(DailyHealth).where(DailyHealth.user_id == user.id, DailyHealth.source == source))
    row = db.scalar(select(Source).where(Source.user_id == user.id, Source.kind == source))
    if row is not None and row.sync_cursor:
        cursor = dict(row.sync_cursor)
        cursor.pop("health" if source == "garmin" else "until", None)
        row.sync_cursor = cursor
    db.commit()


# --- Health Connect, from the Android app (OS-607) -----------------------------------------------------


class StageIn(BaseModel):
    start: datetime
    end: datetime
    stage: Literal["awake", "light", "deep", "rem"]


class SleepUpload(BaseModel):
    id: str = Field(max_length=128, description="Health Connect's record id")
    origin: str | None = Field(default=None, max_length=120, description="The app that wrote it")
    start: datetime
    end: datetime
    utc_offset_s: int | None = Field(default=None, ge=-14 * 3600, le=14 * 3600)
    stages: list[StageIn] = Field(default_factory=list, max_length=500)


class DayUpload(BaseModel):
    day: date
    resting_hr: float | None = Field(default=None, gt=20, lt=200)
    hrv_ms: float | None = Field(default=None, gt=0, lt=500)
    spo2: float | None = Field(default=None, gt=50, le=100)
    respiration: float | None = Field(default=None, gt=2, lt=60)
    steps: int | None = Field(default=None, ge=0, lt=200_000)
    wear_s: int | None = Field(default=None, ge=0, le=86_400)


class HealthConnectUpload(BaseModel):
    sleep: list[SleepUpload] = Field(default_factory=list, max_length=200)
    days: list[DayUpload] = Field(default_factory=list, max_length=400)


@router.post("/health-connect", operation_id="uploadHealthConnect")
def upload_health_connect(body: HealthConnectUpload, db: DbSession, user: CurrentUser) -> dict[str, int]:
    """What the app read from Health Connect. Upserted: sending the same days again is harmless."""
    for s in body.sleep:
        if s.end <= s.start or s.end - s.start > timedelta(hours=24):
            continue
        stages: list[tuple[datetime, datetime, Stage]] = [
            (x.start, x.end, x.stage) for x in s.stages if x.stage in STAGES
        ]
        save_sleep(
            db,
            user.id,
            "health_connect",
            SleepIn(
                external_id=s.id,
                start=s.start,
                end=s.end,
                utc_offset_s=s.utc_offset_s,
                stages=stages or None,
                origin=s.origin,
                nap=(s.end - s.start) < timedelta(hours=3),
            ),
        )
    for d in body.days:
        save_day(db, user.id, "health_connect", DayIn(external_id=f"day:{d.day}", **d.model_dump()))
    source = db.scalar(select(Source).where(Source.user_id == user.id, Source.kind == "health_connect"))
    if source is None:
        source = Source(user_id=user.id, kind="health_connect")
        db.add(source)
    source.last_sync_at = datetime.now(UTC)
    db.commit()
    return {"sleep": len(body.sleep), "days": len(body.days)}


# --- Google Health: connecting (OS-603) ----------------------------------------------------------------


def _key(settings: AppSettings) -> str:
    secret = settings.jwt_secret.get_secret_value() if settings.jwt_secret else "dev-only"
    return hashlib.sha256(f"zankup-google-health-flow:{secret}".encode()).hexdigest()


def _redirect_uri(settings: AppSettings) -> str:
    return f"{_origin(settings)}/api/wellness/google/callback"


def _back(settings: AppSettings, result: str) -> RedirectResponse:
    response = RedirectResponse(
        f"{_origin(settings)}/settings?health={result}#health", status.HTTP_303_SEE_OTHER
    )
    response.delete_cookie(COOKIE, path=COOKIE_PATH)
    return response


def _available(settings: AppSettings) -> str:
    if not settings.integrations()["google_health"] or not settings.google_client_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Google Health is not configured on this instance")
    return settings.google_client_id


@oauth.get("/start", operation_id="googleHealthStart", response_class=RedirectResponse, status_code=303)
def google_start(request: Request, db: DbSession, settings: AppSettings) -> RedirectResponse:
    """Off to Google to allow read-only access to sleep, health measurements and activity."""
    client_id = _available(settings)
    user = _signed_in(request, db, settings)
    verifier, state = secrets.token_urlsafe(48), secrets.token_urlsafe(24)
    flow = jwt.encode(
        {"verifier": verifier, "state": state, "user": user.id, "exp": datetime.now(UTC) + FLOW_TTL},
        _key(settings),
        algorithm="HS256",
    )
    query = urlencode(
        {
            "client_id": client_id,
            "redirect_uri": _redirect_uri(settings),
            "response_type": "code",
            "scope": " ".join(google_health.SCOPES),
            "state": state,
            "code_challenge": _b64(hashlib.sha256(verifier.encode()).digest()),
            "code_challenge_method": "S256",
            "access_type": "offline",
            "prompt": "consent",  # so Google always returns a refresh token
        }
    )
    response = RedirectResponse(f"{AUTHORIZE_URL}?{query}", status.HTTP_303_SEE_OTHER)
    response.set_cookie(
        COOKIE,
        flow,
        max_age=int(FLOW_TTL.total_seconds()),
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        path=COOKIE_PATH,
    )
    return response


@oauth.get("/callback", operation_id="googleHealthCallback", response_class=RedirectResponse, status_code=303)
def google_callback(
    request: Request,
    db: DbSession,
    settings: AppSettings,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    _available(settings)
    try:
        flow = jwt.decode(request.cookies.get(COOKIE, ""), _key(settings), algorithms=["HS256"])
        user = _signed_in(request, db, settings)
    except (jwt.PyJWTError, HTTPException):
        return _back(settings, "error")
    if (
        error
        or not code
        or not state
        or not secrets.compare_digest(state, flow["state"])
        or flow["user"] != user.id
    ):
        return _back(settings, "cancelled" if error == "access_denied" else "error")
    try:
        http = httpx.Client(timeout=15)
        tokens = google_health.exchange_code(settings, code, flow["verifier"], _redirect_uri(settings), http)
        google_health.connect(db, settings, user.id, tokens, None)
        db.commit()
    except (google_health.GoogleHealthError, httpx.HTTPError) as problem:
        log.warning("Google Health connection failed", extra={"reason": str(problem)[:200]})
        return _back(settings, "error")
    enqueue(db, "sync_google_health", user_id=user.id, payload={"trigger": "initial"})
    db.commit()
    log.info("Google Health connected", extra={"user_id": user.id})
    return _back(settings, "connected")


@router.delete("/google", operation_id="disconnectGoogleHealth", status_code=204)
def google_disconnect(db: DbSession, user: CurrentUser, settings: AppSettings) -> None:
    """Revoke Zankup's access at Google and forget the tokens. The data already synced stays."""
    google_health.disconnect(db, settings, user.id)
    db.commit()
