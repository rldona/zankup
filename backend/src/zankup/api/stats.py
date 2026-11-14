"""Stats (OS-303, OS-304, OS-308, OS-311, OS-315, OS-316, OS-317, OS-321, OS-322, OS-326, OS-310).

Every endpoint reads what the engine precomputed (activity_metrics, daily_load, estimates, best
efforts): nothing heavy runs when a screen opens. Periods are `from` (inclusive) and `to` (exclusive)
dates; without them, the last 365 days.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal

from fastapi import Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select

from zankup.api.profile import streak
from zankup.api.routing import protected_router
from zankup.auth.deps import CurrentUser, DbSession
from zankup.db.models import Activity, ActivityMetrics, BestEffort, DailyLoad, EstimateRow
from zankup.engine.user import local_day

router = protected_router(prefix="/api/stats", tags=["stats"])

From = Annotated[date | None, Query(alias="from")]
To = Annotated[date | None, Query(alias="to")]
Sports = Annotated[list[str] | None, Query(description="Only these sports")]


def _range(start: date | None, end: date | None) -> tuple[date, date]:
    today = datetime.now(UTC).date()
    end = end or today + timedelta(days=1)
    return start or end - timedelta(days=365), end


def _utc(day: date) -> datetime:
    return datetime.combine(day, datetime.min.time(), UTC)


def _activities(db: DbSession, user_id: int, start: date, end: date, sport: list[str] | None):  # type: ignore[no-untyped-def]
    query = (
        select(Activity, ActivityMetrics)
        .outerjoin(ActivityMetrics, ActivityMetrics.activity_id == Activity.id)
        # A day either side: the local day is decided after (time zones).
        .where(
            Activity.user_id == user_id,
            Activity.start_utc >= _utc(start - timedelta(days=1)),
            Activity.start_utc < _utc(end + timedelta(days=1)),
        )
        .order_by(Activity.start_utc)
    )
    if sport:
        query = query.where(Activity.sport.in_(sport))
    return [(a, mt) for a, mt in db.execute(query).all() if start <= local_day(a.start_utc, a.timezone) < end]


# --- fitness ---------------------------------------------------------------------------------------


class FitnessDay(BaseModel):
    day: date
    load: float
    ctl: float = Field(description="Fitness")
    atl: float = Field(description="Fatigue")
    tsb: float = Field(description="Form")


@router.get("/fitness", operation_id="getFitness")
def fitness(db: DbSession, user: CurrentUser, start: From = None, end: To = None) -> list[FitnessDay]:
    """Fitness, fatigue and form per day (OS-303)."""
    start, end = _range(start, end)
    rows = db.scalars(
        select(DailyLoad)
        .where(DailyLoad.user_id == user.id, DailyLoad.day >= start, DailyLoad.day < end)
        .order_by(DailyLoad.day)
    )
    return [FitnessDay(day=r.day, load=r.load, ctl=r.ctl, atl=r.atl, tsb=r.tsb) for r in rows]


# --- summary and volume -----------------------------------------------------------------------------


class Totals(BaseModel):
    count: int = 0
    distance_m: float = 0
    moving_s: float = 0
    ascent_m: float = 0
    load: float = Field(0, description="Sum of relative effort")


def _add(totals: Totals, activity: Activity, metrics: ActivityMetrics | None) -> None:
    totals.count += 1
    totals.distance_m += activity.distance_m or 0
    totals.moving_s += activity.moving_s or activity.duration_s
    totals.ascent_m += activity.ascent_m or 0
    totals.load += (metrics.trimp if metrics else None) or 0


class Summary(BaseModel):
    current: Totals
    previous: Totals = Field(description="The same span one year earlier")
    by_sport: dict[str, Totals]


@router.get("/summary", operation_id="getSummary")
def summary(
    db: DbSession, user: CurrentUser, start: From = None, end: To = None, sport: Sports = None
) -> Summary:
    """Totals for a period, by sport, and the same period one year earlier (OS-321)."""
    start, end = _range(start, end)
    current, previous = Totals(), Totals()
    by_sport: dict[str, Totals] = defaultdict(Totals)
    for a, mt in _activities(db, user.id, start, end, sport):
        _add(current, a, mt)
        _add(by_sport[a.sport], a, mt)
    year = timedelta(days=365)
    for a, mt in _activities(db, user.id, start - year, end - year, sport):
        _add(previous, a, mt)
    return Summary(current=current, previous=previous, by_sport=dict(by_sport))


class Bucket(BaseModel):
    start: date
    totals: Totals
    by_sport: dict[str, Totals]


def _bucket(day: date, unit: str) -> date:
    if unit == "week":
        return day - timedelta(days=day.weekday())
    if unit == "month":
        return day.replace(day=1)
    if unit == "year":
        return day.replace(month=1, day=1)
    return day


def _next(day: date, unit: str) -> date:
    if unit == "week":
        return day + timedelta(days=7)
    if unit == "month":
        return (day.replace(day=28) + timedelta(days=4)).replace(day=1)
    if unit == "year":
        return day.replace(year=day.year + 1)
    return day + timedelta(days=1)


@router.get("/volume", operation_id="getVolume")
def volume(
    db: DbSession,
    user: CurrentUser,
    start: From = None,
    end: To = None,
    unit: Literal["day", "week", "month", "year"] = "week",
    sport: Sports = None,
) -> list[Bucket]:
    """Distance, time, elevation and load per day, week, month or year, by sport (OS-308). Empty
    buckets are included, so charts have no holes."""
    start, end = _range(start, end)
    buckets: dict[date, Bucket] = {}
    day = _bucket(start, unit)
    while day < end:
        buckets[day] = Bucket(start=day, totals=Totals(), by_sport={})
        day = _next(day, unit)
    for a, mt in _activities(db, user.id, start, end, sport):
        bucket = buckets.get(_bucket(local_day(a.start_utc, a.timezone), unit))
        if bucket is not None:
            _add(bucket.totals, a, mt)
            _add(bucket.by_sport.setdefault(a.sport, Totals()), a, mt)
    return list(buckets.values())


# --- curves -----------------------------------------------------------------------------------------


class CurvePoint(BaseModel):
    duration_s: int
    value: float = Field(description="Watts, m/s or bpm")
    activity_id: int
    day: date


@router.get("/curves", operation_id="getCurves")
def curves(
    db: DbSession,
    user: CurrentUser,
    kind: Literal["power", "speed", "hr"] = "power",
    start: From = None,
    end: To = None,
    sport: Sports = None,
) -> list[CurvePoint]:
    """The best effort for each duration in a period, with the activity it comes from (OS-315)."""
    start, end = _range(start, end)
    column = {
        "power": ActivityMetrics.power_curve,
        "speed": ActivityMetrics.speed_curve,
        "hr": ActivityMetrics.hr_curve,
    }[kind]
    best: dict[int, CurvePoint] = {}
    for a, mt in _activities(db, user.id, start, end, sport):
        curve = getattr(mt, column.key) if mt else None
        for duration, value in (curve or {}).items():
            d = int(duration)
            if d not in best or value > best[d].value:
                best[d] = CurvePoint(
                    duration_s=d, value=value, activity_id=a.id, day=local_day(a.start_utc, a.timezone)
                )
    return [best[d] for d in sorted(best)]


# --- records ----------------------------------------------------------------------------------------


class RecordOut(BaseModel):
    distance_key: str
    distance_m: float
    time_s: float
    activity_id: int
    day: date


class Records(BaseModel):
    all_time: list[RecordOut]
    period: list[RecordOut] = Field(description="Bests of the period asked for")
    progression: dict[str, list[RecordOut]] = Field(description="Each time a record was beaten")


@router.get("/records", operation_id="getRecords")
def records(db: DbSession, user: CurrentUser, start: From = None, end: To = None) -> Records:
    """Running records: all time, the period's bests and how each record progressed (OS-304)."""
    start, end = _range(start, end)
    rows = db.execute(
        select(BestEffort, Activity.start_utc, Activity.timezone)
        .join(Activity, Activity.id == BestEffort.activity_id)
        .where(BestEffort.user_id == user.id)
        .order_by(Activity.start_utc)
    ).all()
    all_time: dict[str, RecordOut] = {}
    period: dict[str, RecordOut] = {}
    progression: dict[str, list[RecordOut]] = defaultdict(list)
    for effort, started, timezone in rows:
        out = RecordOut(
            distance_key=effort.distance_key,
            distance_m=effort.distance_m,
            time_s=effort.time_s,
            activity_id=effort.activity_id,
            day=local_day(started, timezone),
        )
        key = effort.distance_key
        if key not in all_time or effort.time_s < all_time[key].time_s:
            all_time[key] = out
            progression[key].append(out)
        if start <= out.day < end and (key not in period or effort.time_s < period[key].time_s):
            period[key] = out
    order = lambda r: r.distance_m  # noqa: E731
    return Records(
        all_time=sorted(all_time.values(), key=order),
        period=sorted(period.values(), key=order),
        progression=dict(progression),
    )


# --- estimates --------------------------------------------------------------------------------------


class Source(BaseModel):
    id: int
    name: str | None
    sport: str
    day: date


class EstimatePoint(BaseModel):
    day: date
    value: float


class EstimateOut(BaseModel):
    kind: str
    value: float
    method: str
    day: date
    sources: list[Source]
    history: list[EstimatePoint] = Field(description="Each time it changed")


@router.get("/estimates", operation_id="getEstimates")
def estimates(db: DbSession, user: CurrentUser) -> list[EstimateOut]:
    """Each estimate's latest value, how it was made, the activities behind it and its history (OS-316)."""
    rows = list(
        db.scalars(select(EstimateRow).where(EstimateRow.user_id == user.id).order_by(EstimateRow.day))
    )
    by_kind: dict[str, list[EstimateRow]] = defaultdict(list)
    for r in rows:
        by_kind[r.kind].append(r)
    ids = {i for r in rows for i in r.source_activity_ids}
    activities = {
        a.id: a for a in db.scalars(select(Activity).where(Activity.id.in_(ids), Activity.user_id == user.id))
    }
    out = []
    for kind, history in by_kind.items():
        latest = history[-1]
        sources = [
            Source(id=a.id, name=a.name, sport=a.sport, day=local_day(a.start_utc, a.timezone))
            for i in latest.source_activity_ids
            if (a := activities.get(i))
        ]
        changes: list[EstimatePoint] = []
        for r in history:
            if not changes or abs(changes[-1].value - r.value) > 1e-6:
                changes.append(EstimatePoint(day=r.day, value=r.value))
        out.append(
            EstimateOut(
                kind=kind,
                value=latest.value,
                method=latest.method,
                day=latest.day,
                sources=sources,
                history=changes,
            )
        )
    return out


# --- progress and efficiency -----------------------------------------------------------------------


class YearLine(BaseModel):
    year: int
    cumulative_m: list[float] = Field(description="Distance up to each day of the year (index 0 = 1 Jan)")


@router.get("/progress", operation_id="getProgress")
def progress(
    db: DbSession, user: CurrentUser, sport: Sports = None, years: int = Query(5, ge=1, le=20)
) -> list[YearLine]:
    """Cumulative distance per day of the year, one line per year (OS-322)."""
    today = datetime.now(UTC).date()
    first = date(today.year - years + 1, 1, 1)
    per_day: dict[int, list[float]] = {}
    for a, _ in _activities(db, user.id, first, today + timedelta(days=1), sport):
        day = local_day(a.start_utc, a.timezone)
        line = per_day.setdefault(day.year, [0.0] * 366)
        line[day.timetuple().tm_yday - 1] += a.distance_m or 0
    out = []
    for year in range(first.year, today.year + 1):
        daily = per_day.get(year, [0.0] * 366)
        last = (
            (today - date(year, 1, 1)).days + 1
            if year == today.year
            else (date(year + 1, 1, 1) - date(year, 1, 1)).days
        )
        total, cumulative = 0.0, []
        for value in daily[:last]:
            total += value
            cumulative.append(round(total, 1))
        out.append(YearLine(year=year, cumulative_m=cumulative))
    return out


class EfficiencyPoint(BaseModel):
    day: date
    activity_id: int
    efficiency: float = Field(description="Speed (m/min) per bpm")
    decoupling: float | None


@router.get("/efficiency", operation_id="getEfficiency")
def efficiency(
    db: DbSession, user: CurrentUser, start: From = None, end: To = None, sport: str = "run"
) -> list[EfficiencyPoint]:
    """Aerobic efficiency over time: pace at equal HR getting better (OS-317)."""
    start, end = _range(start, end)
    return [
        EfficiencyPoint(
            day=local_day(a.start_utc, a.timezone),
            activity_id=a.id,
            efficiency=mt.efficiency,
            decoupling=mt.decoupling,
        )
        for a, mt in _activities(db, user.id, start, end, [sport])
        if mt is not None and mt.efficiency is not None
    ]


# --- calendar and heatmap ---------------------------------------------------------------------------


class CalendarActivity(BaseModel):
    id: int
    sport: str
    name: str | None
    load: float | None
    distance_m: float | None
    moving_s: float
    ascent_m: float | None = None
    start: datetime = Field(description="Start time (UTC)")


class CalendarDay(BaseModel):
    day: date
    tsb: float | None
    activities: list[CalendarActivity]


@router.get("/calendar", operation_id="getCalendar")
def calendar(db: DbSession, user: CurrentUser, start: From = None, end: To = None) -> list[CalendarDay]:
    """Every day of the period with its activities (sized by load) and form (OS-326)."""
    today = datetime.now(UTC).date()
    start = start or today.replace(day=1)
    end = end or _next(start, "month")
    form = {
        r.day: r.tsb
        for r in db.scalars(
            select(DailyLoad).where(DailyLoad.user_id == user.id, DailyLoad.day >= start, DailyLoad.day < end)
        )
    }
    days: dict[date, CalendarDay] = {}
    day = start
    while day < end:
        days[day] = CalendarDay(day=day, tsb=form.get(day), activities=[])
        day += timedelta(days=1)
    for a, mt in _activities(db, user.id, start, end, None):
        d = days.get(local_day(a.start_utc, a.timezone))
        if d is not None:
            d.activities.append(
                CalendarActivity(
                    id=a.id,
                    sport=a.sport,
                    name=a.name,
                    load=mt.trimp if mt else None,
                    distance_m=a.distance_m,
                    moving_s=a.moving_s or a.duration_s,
                    ascent_m=a.ascent_m,
                    start=a.start_utc,
                )
            )
    return list(days.values())


class Streak(BaseModel):
    weeks: int = Field(description="Weeks in a row with an activity, up to this week or the last")
    activities: int = Field(description="Activities in those weeks")
    since: date | None = Field(description="Monday of the streak's first week")
    first_activity: date | None = Field(description="Day of the first activity ever")


def _monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


@router.get("/streak", operation_id="getStreak")
def streak_summary(db: DbSession, user: CurrentUser) -> Streak:
    """The weekly streak (Progress → Series): how many weeks in a row, with how many activities."""
    today = datetime.now(UTC).date()
    starts = [
        local_day(s, tz)
        for s, tz in db.execute(
            select(Activity.start_utc, Activity.timezone).where(Activity.user_id == user.id)
        )
    ]
    weeks = {_monday(d) for d in starts}
    count = streak(weeks, today)
    if not count:
        return Streak(weeks=0, activities=0, since=None, first_activity=min(starts, default=None))
    last = _monday(today) if _monday(today) in weeks else _monday(today) - timedelta(weeks=1)
    since = last - timedelta(weeks=count - 1)
    return Streak(
        weeks=count,
        activities=sum(1 for d in starts if d >= since),
        since=since,
        first_activity=min(starts),
    )


class Heatmap(BaseModel):
    routes: list[str] = Field(description="Encoded polylines (precision 5)")


@router.get("/heatmap", operation_id="getHeatmap")
def heatmap(
    db: DbSession, user: CurrentUser, start: From = None, end: To = None, sport: Sports = None
) -> Heatmap:
    """Every route of the period, for the personal heatmap (OS-310)."""
    start, end = (start or date(2000, 1, 1)), (end or datetime.now(UTC).date() + timedelta(days=1))
    query = select(Activity.route_simplified).where(
        and_(
            Activity.user_id == user.id,
            Activity.route_simplified.is_not(None),
            Activity.start_utc >= _utc(start),
            Activity.start_utc < _utc(end),
        )
    )
    if sport:
        query = query.where(Activity.sport.in_(sport))
    return Heatmap(routes=[r for r in db.scalars(query) if r])


@router.get("/years", operation_id="getYears")
def years(db: DbSession, user: CurrentUser) -> list[int]:
    """Years with activities, newest first: the period selector's options."""
    first = db.scalar(select(func.min(Activity.start_utc)).where(Activity.user_id == user.id))
    if first is None:
        return []
    return list(range(datetime.now(UTC).year, first.year - 1, -1))
