"""The Google Health API (OS-603): Fitbit Air and Google's other devices.

- Connecting: Google OAuth 2.0 (authorization code with PKCE), asking only for three read-only scopes.
  The refresh token is kept encrypted (`Source.secret`, zankup.health.crypto); the hour-long access
  token in `Source.access_token`. Each instance uses its own OAuth client (GOOGLE_CLIENT_ID), with
  `<origin>/api/wellness/google/callback` as an extra redirect URI and the Google Health API enabled.
- Syncing: incremental from the cursor's last day (fetching the last three days again: a night's data
  can arrive late). Sleep sessions with stages; the daily resting HR, HRV, SpO₂ and respiratory rate;
  steps from the daily roll-up; and the hours with heart-rate data (hourly roll-up), which is how much
  the device was worn (OS-605).
- A data type whose scope the person did not grant (Google's consent screen lets them untick it) is
  skipped and listed in the cursor (`missing`). A refresh token Google no longer accepts (revoked, or
  the 7-day expiry of OAuth apps in "Testing" mode) marks the source as needing to be connected again
  and sends a notification.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from zankup.core.config import Settings
from zankup.db.models import SleepSession, Source
from zankup.health import crypto
from zankup.health.store import DayIn, SleepIn, Stage, save_day, save_sleep

log = logging.getLogger("zankup.health.google")

SOURCE = "google_health"
BASE_URL = "https://health.googleapis.com/v4"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
SCOPES = (
    "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
    "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
    "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
)
FIRST_DAYS = 30
REFETCH = timedelta(days=3)
EVERY = timedelta(hours=1)
STAGE_TYPES: dict[str, Stage] = {"AWAKE": "awake", "LIGHT": "light", "DEEP": "deep", "REM": "rem"}
# Daily data types: (path name, filter name, JSON field, value field, DayIn field)
DAILY = (
    (
        "daily-resting-heart-rate",
        "daily_resting_heart_rate",
        "dailyRestingHeartRate",
        "beatsPerMinute",
        "resting_hr",
    ),
    (
        "daily-heart-rate-variability",
        "daily_heart_rate_variability",
        "dailyHeartRateVariability",
        "averageHeartRateVariabilityMilliseconds",
        "hrv_ms",
    ),
    (
        "daily-oxygen-saturation",
        "daily_oxygen_saturation",
        "dailyOxygenSaturation",
        "averagePercentage",
        "spo2",
    ),
    (
        "daily-respiratory-rate",
        "daily_respiratory_rate",
        "dailyRespiratoryRate",
        "breathsPerMinute",
        "respiration",
    ),
)


class GoogleHealthError(RuntimeError):
    pass


class Reauthorise(GoogleHealthError):
    """Google no longer accepts the refresh token: the person has to connect again."""


class MissingScope(GoogleHealthError):
    pass


def context(user_id: int) -> str:
    return f"{SOURCE}:{user_id}"


def source_row(session: Session, user_id: int) -> Source | None:
    return session.scalar(select(Source).where(Source.user_id == user_id, Source.kind == SOURCE))


# --- OAuth ---------------------------------------------------------------------------------------------


def exchange_code(
    settings: Settings, code: str, verifier: str, redirect_uri: str, http: httpx.Client | None = None
) -> dict[str, Any]:
    assert settings.google_client_id and settings.google_client_secret
    response = (http or httpx.Client(timeout=15)).post(
        TOKEN_URL,
        data={
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": verifier,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret.get_secret_value(),
            "redirect_uri": redirect_uri,
        },
    )
    if response.status_code != 200:
        raise GoogleHealthError(f"Token exchange failed: HTTP {response.status_code} {response.text[:200]}")
    return dict(response.json())


def connect(
    session: Session, settings: Settings, user_id: int, tokens: dict[str, Any], health_user_id: str | None
) -> Source:
    """Keep the tokens (the refresh one encrypted) and start the sync from scratch."""
    refresh = tokens.get("refresh_token")
    if not refresh:
        raise GoogleHealthError("Google did not return a refresh token")
    source = source_row(session, user_id)
    if source is None:
        source = Source(user_id=user_id, kind=SOURCE)
        session.add(source)
    source.secret = crypto.encrypt(settings, str(refresh), context=context(user_id))
    source.access_token = str(tokens.get("access_token") or "") or None
    source.token_expires_at = datetime.now(UTC) + timedelta(seconds=int(tokens.get("expires_in", 3600)))
    granted = set(str(tokens.get("scope", " ".join(SCOPES))).split())
    source.sync_cursor = {
        "health_user_id": health_user_id,
        "missing": sorted(s.rsplit(".", 2)[-2] for s in SCOPES if s not in granted),
    }
    source.last_sync_at = None
    return source


def disconnect(session: Session, settings: Settings, user_id: int, http: httpx.Client | None = None) -> bool:
    source = source_row(session, user_id)
    if source is None:
        return False
    token = crypto.decrypt(settings, source.secret, context=context(user_id))
    if token:
        try:
            (http or httpx.Client(timeout=10)).post(REVOKE_URL, data={"token": token})
        except httpx.HTTPError:
            log.warning("Could not revoke the Google Health token")
    session.delete(source)
    return True


class Tokens:
    """The access token, refreshed with the stored refresh token when it is about to expire."""

    def __init__(self, sessions: sessionmaker[Session], settings: Settings, user_id: int, http: httpx.Client):
        self.sessions, self.settings, self.user_id, self.http = sessions, settings, user_id, http

    def get(self, *, force: bool = False) -> str:
        with self.sessions.begin() as session:
            source = source_row(session, self.user_id)
            if source is None:
                raise Reauthorise("Google Health is not connected")
            now = datetime.now(UTC)
            if (
                not force
                and source.access_token
                and source.token_expires_at
                and source.token_expires_at - timedelta(minutes=5) > now
            ):
                return source.access_token
            refresh = crypto.decrypt(self.settings, source.secret, context=context(self.user_id))
            if not refresh or not self.settings.google_client_id or not self.settings.google_client_secret:
                raise Reauthorise("The stored Google Health token cannot be used")
            response = self.http.post(
                TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh,
                    "client_id": self.settings.google_client_id,
                    "client_secret": self.settings.google_client_secret.get_secret_value(),
                },
            )
            if response.status_code in (400, 401):
                raise Reauthorise(f"Google refused the refresh token: {response.text[:200]}")
            if response.status_code != 200:
                raise GoogleHealthError(f"Token refresh failed: HTTP {response.status_code}")
            body = response.json()
            source.access_token = str(body["access_token"])
            source.token_expires_at = now + timedelta(seconds=int(body.get("expires_in", 3600)))
            if body.get("refresh_token"):
                source.secret = crypto.encrypt(
                    self.settings, str(body["refresh_token"]), context=context(self.user_id)
                )
            return source.access_token


# --- the API -------------------------------------------------------------------------------------------


@dataclass
class GoogleHealth:
    tokens: Tokens
    http: httpx.Client
    base_url: str = BASE_URL

    def request(self, method: str, path: str, **kwargs: Any) -> Any:
        for attempt in range(2):
            token = self.tokens.get(force=attempt > 0)
            response = self.http.request(
                method,
                f"{self.base_url}/{path}",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                **kwargs,
            )
            if response.status_code == 401 and attempt == 0:
                continue
            if response.status_code == 403 and "MISSING_OAUTH_SCOPE" in response.text:
                raise MissingScope(path)
            if response.status_code >= 400:
                raise GoogleHealthError(f"{method} {path}: HTTP {response.status_code} {response.text[:200]}")
            return response.json() if response.content else {}
        raise GoogleHealthError(f"{method} {path}: unauthorised")

    def identity(self) -> str | None:
        value = self.request("GET", "users/me/identity").get("healthUserId")
        return str(value) if value else None

    def points(self, data_type: str, filter: str, page_size: int) -> Iterator[dict[str, Any]]:
        token = None
        while True:
            params: dict[str, Any] = {"filter": filter, "pageSize": page_size}
            if token:
                params["pageToken"] = token
            body = self.request("GET", f"users/me/dataTypes/{data_type}/dataPoints", params=params)
            yield from body.get("dataPoints") or []
            token = body.get("nextPageToken")
            if not token:
                return

    def daily_steps(self, first: date, last: date) -> dict[date, int]:
        out: dict[date, int] = {}
        start = first
        while start <= last:
            end = min(start + timedelta(days=89), last)
            body = self.request(
                "POST",
                "users/me/dataTypes/steps/dataPoints:dailyRollUp",
                json={
                    "range": {
                        "start": {"date": _civil(start)},
                        "end": {"date": _civil(end + timedelta(days=1))},
                    },
                    "windowSizeDays": 1,
                },
            )
            for point in body.get("rollupDataPoints") or []:
                day = _civil_date(point.get("civilStartTime"))
                count = (point.get("steps") or {}).get("countSum")
                if day and count is not None:
                    out[day] = int(count)
            start = end + timedelta(days=1)
        return out

    def worn_hours(self, first: date, last: date, offset_s: int) -> dict[date, int]:
        """Seconds per local day with heart-rate data, from an hourly roll-up (14 days per request)."""
        out: dict[date, int] = {}
        start = datetime.combine(first, datetime.min.time(), UTC) - timedelta(seconds=offset_s)
        stop = datetime.combine(last + timedelta(days=1), datetime.min.time(), UTC) - timedelta(
            seconds=offset_s
        )
        while start < stop:
            end = min(start + timedelta(days=14), stop)
            token = None
            while True:
                body: dict[str, Any] = {
                    "range": {"startTime": _rfc3339(start), "endTime": _rfc3339(end)},
                    "windowSize": "3600s",
                }
                if token:
                    body["pageToken"] = token
                answer = self.request("POST", "users/me/dataTypes/heart-rate/dataPoints:rollUp", json=body)
                for point in answer.get("rollupDataPoints") or []:
                    when = _time(point.get("startTime"))
                    if when is not None and point.get("heartRate"):
                        day = (when + timedelta(seconds=offset_s)).date()
                        out[day] = out.get(day, 0) + 3600
                token = answer.get("nextPageToken")
                if not token:
                    break
            start = end
        return out


def _civil(day: date) -> dict[str, int]:
    return {"year": day.year, "month": day.month, "day": day.day}


def _civil_date(value: Any) -> date | None:
    if isinstance(value, dict):
        value = value.get("date", value)
        try:
            return date(int(value["year"]), int(value["month"]), int(value["day"]))
        except (KeyError, TypeError, ValueError):
            return None
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _rfc3339(when: datetime) -> str:
    return when.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _time(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _seconds(value: Any) -> int | None:
    """Google durations and offsets are strings like "-14400s"."""
    if isinstance(value, str) and value.endswith("s"):
        try:
            return int(float(value[:-1]))
        except ValueError:
            return None
    return None


def _minutes(value: Any) -> int | None:
    try:
        return int(value) * 60 if value is not None else None
    except (TypeError, ValueError):
        return None


def parse_sleep(point: dict[str, Any]) -> SleepIn | None:
    sleep = point.get("sleep") or {}
    interval = sleep.get("interval") or {}
    start, end = _time(interval.get("startTime")), _time(interval.get("endTime"))
    if start is None or end is None or end <= start:
        return None
    stages: list[tuple[datetime, datetime, Stage]] = []
    for stage in sleep.get("stages") or []:
        a, b, kind = (
            _time(stage.get("startTime")),
            _time(stage.get("endTime")),
            STAGE_TYPES.get(stage.get("type", "")),
        )
        if a and b and kind:
            stages.append((a, b, kind))
    summary = sleep.get("summary") or {}
    metadata = sleep.get("metadata") or point.get("metadata") or {}
    return SleepIn(
        external_id=str(point.get("name", "")).rsplit("/", 1)[-1] or start.isoformat(),
        start=start,
        end=end,
        utc_offset_s=_seconds(interval.get("endUtcOffset")),
        stages=stages or None,
        asleep_s=_minutes(summary.get("minutesAsleep")),
        awake_s=_minutes(summary.get("minutesAwake")),
        nap=metadata.get("main") is False,
    )


def parse_daily(point: dict[str, Any], field: str, value: str) -> tuple[date, float] | None:
    body = point.get(field) or {}
    day = _civil_date(body.get("date"))
    try:
        number = float(body[value])
    except (KeyError, TypeError, ValueError):
        return None
    return (day, number) if day and number > 0 else None


# --- sync ----------------------------------------------------------------------------------------------


def due(session: Session, user_id: int, now: datetime) -> bool:
    source = source_row(session, user_id)
    if source is None or (source.sync_cursor or {}).get("reauth"):
        return False
    return source.last_sync_at is None or now - source.last_sync_at >= EVERY - timedelta(minutes=5)


def _update_cursor(sessions: sessionmaker[Session], user_id: int, **values: Any) -> None:
    with sessions.begin() as session:
        source = source_row(session, user_id)
        if source is not None:
            source.sync_cursor = {**(source.sync_cursor or {}), **values}


def sync(
    sessions: sessionmaker[Session],
    settings: Settings,
    user_id: int,
    *,
    since: date | None = None,
    http: httpx.Client | None = None,
    today: date | None = None,
) -> int:
    """Fetch and save from `since` (or the cursor) to today. Returns the number of items saved."""
    http = http or httpx.Client(timeout=30)
    api = GoogleHealth(Tokens(sessions, settings, user_id, http), http)
    today = today or datetime.now(UTC).date()
    with sessions() as session:
        source = source_row(session, user_id)
        if source is None:
            return 0
        cursor = dict(source.sync_cursor or {})
    if since is None:
        since = (
            date.fromisoformat(cursor["until"]) - REFETCH
            if cursor.get("until")
            else today - timedelta(days=FIRST_DAYS)
        )
    missing: set[str] = set()
    saved = 0
    try:
        if not cursor.get("health_user_id"):
            _update_cursor(sessions, user_id, health_user_id=api.identity())

        try:
            nights = [
                n
                for p in api.points("sleep", f'sleep.interval.civil_end_time >= "{since}"', 25)
                if (n := parse_sleep(p)) is not None
            ]
            with sessions.begin() as session:
                for night in nights:
                    save_sleep(session, user_id, SOURCE, night)
            saved += len(nights)
        except MissingScope:
            missing.add("sleep")

        days: dict[date, DayIn] = {}

        def day(d: date) -> DayIn:
            return days.setdefault(d, DayIn(day=d, external_id=f"day:{d}"))

        for path, name, field, value, target in DAILY:
            try:
                for point in api.points(path, f'{name}.date >= "{since}"', 1000):
                    parsed = parse_daily(point, field, value)
                    if parsed:
                        setattr(day(parsed[0]), target, parsed[1])
            except MissingScope:
                missing.add("health_metrics_and_measurements")
        try:
            for d, count in api.daily_steps(since, today).items():
                day(d).steps = count
        except MissingScope:
            missing.add("activity_and_fitness")
        try:
            with sessions() as session:
                offset = session.scalar(
                    select(SleepSession.utc_offset_s)
                    .where(SleepSession.user_id == user_id, SleepSession.source == SOURCE)
                    .order_by(SleepSession.end_utc.desc())
                    .limit(1)
                )
            for d, seconds in api.worn_hours(since, today, offset or 0).items():
                day(d).wear_s = seconds
        except MissingScope:
            missing.add("health_metrics_and_measurements")
        with sessions.begin() as session:
            for item in days.values():
                save_day(session, user_id, SOURCE, item)
        saved += len(days)
    except Reauthorise as error:
        log.warning("Google Health needs to be connected again", extra={"error": str(error)[:200]})
        with sessions.begin() as session:
            source = source_row(session, user_id)
            if source is not None and not (source.sync_cursor or {}).get("reauth"):
                source.sync_cursor = {**(source.sync_cursor or {}), "reauth": True}
                source.access_token = None
                from zankup.notify import notify

                notify(session, user_id, "health_reauth", {}, key=f"health_reauth:{datetime.now(UTC).date()}")
        return saved

    with sessions.begin() as session:
        source = source_row(session, user_id)
        if source is not None:
            until = max(date.fromisoformat(cursor["until"]), today) if cursor.get("until") else today
            source.sync_cursor = {
                **(source.sync_cursor or {}),
                "until": until.isoformat(),
                "missing": sorted(missing),
                "reauth": False,
            }
            source.last_sync_at = datetime.now(UTC)
    log.info("Google Health synced", extra={"user_id": user_id, "saved": saved, "missing": sorted(missing)})
    return saved
