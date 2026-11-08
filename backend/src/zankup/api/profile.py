"""The profile screen (OS-218): the year's numbers and all-time history by sport, records, the streak
of active weeks, the watch, and the state of the data sources."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy import extract, func, select

from zankup.api.routing import protected_router
from zankup.auth.deps import AppSettings, CurrentUser, DbSession
from zankup.db.models import Activity, BestEffort, Source, SyncRun

router = protected_router(prefix="/api", tags=["profile"])


class SportTotals(BaseModel):
    sport: str
    count: int
    distance_m: float
    moving_s: float
    ascent_m: float


class Record(BaseModel):
    distance_key: str
    distance_m: float
    time_s: float
    activity_id: int
    date: datetime


class ProfileSummary(BaseModel):
    year: int
    this_year: list[SportTotals] = Field(description="This calendar year, by sport, most active first")
    all_time: list[SportTotals]
    since: datetime | None = Field(description="Start of the first activity")
    records: list[Record] = Field(description="Best time ever at each running distance")
    streak_weeks: int = Field(description="Weeks in a row with an activity, up to this week or the last")
    device: str | None = Field(description="The device of the latest activity")


def _totals(db: DbSession, user_id: int, year: int | None) -> list[SportTotals]:
    query = (
        select(
            Activity.sport,
            func.count(),
            func.coalesce(func.sum(Activity.distance_m), 0),
            func.sum(func.coalesce(Activity.moving_s, Activity.duration_s)),
            func.coalesce(func.sum(Activity.ascent_m), 0),
        )
        .where(Activity.user_id == user_id)
        .group_by(Activity.sport)
        .order_by(func.count().desc())
    )
    if year is not None:
        query = query.where(extract("year", Activity.start_utc) == year)
    return [
        SportTotals(sport=s, count=n, distance_m=d, moving_s=t, ascent_m=a)
        for s, n, d, t, a in db.execute(query)
    ]


def streak(weeks: set[date], today: date) -> int:
    """Consecutive weeks (starting Monday) with an activity, counting back from this week, or from
    last week when this one has none yet."""
    week = today - timedelta(days=today.weekday())
    if week not in weeks:
        week -= timedelta(weeks=1)
    count = 0
    while week in weeks:
        count += 1
        week -= timedelta(weeks=1)
    return count


@router.get("/profile/summary", operation_id="getProfileSummary")
def profile_summary(db: DbSession, user: CurrentUser) -> ProfileSummary:
    now = datetime.now(UTC)
    starts = db.scalars(
        select(Activity.start_utc).where(
            Activity.user_id == user.id, Activity.start_utc >= now - timedelta(days=3 * 366)
        )
    )
    weeks = {(s.date() - timedelta(days=s.weekday())) for s in starts}
    best = (
        select(BestEffort.distance_key, func.min(BestEffort.time_s).label("time_s"))
        .where(BestEffort.user_id == user.id)
        .group_by(BestEffort.distance_key)
        .subquery()
    )
    records = db.execute(
        select(
            BestEffort.distance_key, BestEffort.distance_m, BestEffort.time_s, Activity.id, Activity.start_utc
        )
        .join(best, (best.c.distance_key == BestEffort.distance_key) & (best.c.time_s == BestEffort.time_s))
        .join(Activity, Activity.id == BestEffort.activity_id)
        .where(BestEffort.user_id == user.id)
        .order_by(BestEffort.distance_m)
    )
    seen: set[str] = set()
    record_list = []
    for key, distance, time_s, activity_id, start in records:
        if key not in seen:  # ties: keep the first
            seen.add(key)
            record_list.append(
                Record(
                    distance_key=key, distance_m=distance, time_s=time_s, activity_id=activity_id, date=start
                )
            )
    return ProfileSummary(
        year=now.year,
        this_year=_totals(db, user.id, now.year),
        all_time=_totals(db, user.id, None),
        since=db.scalar(select(func.min(Activity.start_utc)).where(Activity.user_id == user.id)),
        records=record_list,
        streak_weeks=streak(weeks, now.date()),
        device=db.scalar(
            select(Activity.device)
            .where(Activity.user_id == user.id, Activity.device.is_not(None))
            .order_by(Activity.start_utc.desc())
            .limit(1)
        ),
    )


class SourceStatus(BaseModel):
    kind: Literal["garmin"]
    configured: bool = Field(description="The key is set on the server")
    key_expires_on: date | None = Field(description="When the key expires, if the server was told")
    expiring_soon: bool = Field(description="Less than two weeks left")
    token_expires_at: datetime | None = Field(description="The current short-lived access token")
    last_sync_at: datetime | None
    last_error: str | None = Field(description="The latest sync's error, if it failed")


@router.get("/sources", operation_id="listSources")
def list_sources(db: DbSession, user: CurrentUser, settings: AppSettings) -> list[SourceStatus]:
    """Data sources and their state, for Settings and the profile's Account tab."""
    source = db.scalar(select(Source).where(Source.user_id == user.id, Source.kind == "garmin"))
    last = db.scalar(
        select(SyncRun).where(SyncRun.user_id == user.id).order_by(SyncRun.started_at.desc()).limit(1)
    )
    expires = settings.garmin_key_expires_on
    return [
        SourceStatus(
            kind="garmin",
            configured=settings.garmin_personal_api_key is not None,
            key_expires_on=expires,
            expiring_soon=expires is not None and expires - datetime.now(UTC).date() <= timedelta(days=14),
            token_expires_at=source.token_expires_at if source else None,
            last_sync_at=source.last_sync_at if source else None,
            last_error=last.error if last is not None and last.status == "error" else None,
        )
    ]
