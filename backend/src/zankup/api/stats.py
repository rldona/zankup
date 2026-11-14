"""Stats (OS-303, OS-304, OS-308, OS-311, OS-315, OS-316, OS-317, OS-321, OS-322, OS-326, OS-310).

Every endpoint reads what the engine precomputed (activity_metrics, daily_load, estimates, best
efforts): nothing heavy runs when a screen opens. Periods are `from` (inclusive) and `to` (exclusive)
dates; without them, the last 365 days.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal

from fastapi import HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select

import zankup_metrics as m
from zankup.api.profile import streak
from zankup.api.routing import protected_router
from zankup.auth.deps import CurrentUser, DbSession
from zankup.db.models import Activity, ActivityMetrics, BestEffort, DailyLoad, EstimateRow
from zankup.engine.athlete import athlete
from zankup.engine.user import local_day, race_history

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
    history: list[EstimatePoint] = Field(
        description="Each time it changed; race times, as they stood each week of the last six months"
    )


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
    races = race_history(db, user.id, datetime.now(UTC).date())
    out = []
    for kind, history in by_kind.items():
        latest = history[-1]
        sources = [
            Source(id=a.id, name=a.name, sport=a.sport, day=local_day(a.start_utc, a.timezone))
            for i in latest.source_activity_ids
            if (a := activities.get(i))
        ]
        changes: list[EstimatePoint] = []
        if kind in races:
            changes = [EstimatePoint(day=d, value=round(v, 3)) for d, v in races[kind]]
        else:
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


# --- training zones (Progress) ---------------------------------------------------------------------


class ZonesOut(BaseModel):
    kind: str
    bounds: list[float] = Field(description="Each zone's lower bound (bpm or W) with today's settings")
    seconds: list[float] = Field(description="Time in each zone in the period")
    previous: list[float] = Field(description="The same, over the span just before the period")


@router.get("/zones", operation_id="getZones")
def zones(
    db: DbSession,
    user: CurrentUser,
    kind: Literal["hr", "power"] = "hr",
    start: From = None,
    end: To = None,
    sport: Sports = None,
) -> ZonesOut:
    """Time in each HR or power zone over a period and the span before it (Progress → Training zones)."""
    start, end = _range(start, end)
    who = athlete(db, user.id)
    if kind == "hr":
        bounds = m.hr_zones(who.zone_method, who.hr_max, who.hr_rest, who.lthr)
    else:
        bounds = m.power_zones(who.ftp) if who.ftp else []
    count = 5 if kind == "hr" else 7

    def total(a: date, b: date) -> list[float]:
        out = [0.0] * count
        for _, mt in _activities(db, user.id, a, b, sport):
            for i, s in enumerate((mt and (mt.hr_zones if kind == "hr" else mt.power_zones)) or []):
                if i < count:
                    out[i] += s
        return [round(s, 1) for s in out]

    return ZonesOut(
        kind=kind,
        bounds=[round(b) for b in bounds],
        seconds=total(start, end),
        previous=total(start - (end - start), start),
    )


# --- best times (Progress) -------------------------------------------------------------------------

# A ride's best power over these durations; with the run distances and the longest ride, the bests.
POWER_BESTS = (5, 15, 30, 60, 300, 600, 1200, 3600)
BEST_KEYS = (*m.RUN_DISTANCES, *(f"power_{d}" for d in POWER_BESTS), "longest")


class BestOut(BaseModel):
    activity_id: int
    name: str | None
    day: date
    value: float = Field(description="Seconds (a run distance), watts (power_…) or metres (longest)")


def _bests(db: DbSession, user_id: int, key: str) -> list[BestOut]:
    found: list[tuple[Activity, float]] = []
    if key in m.RUN_DISTANCES:
        for time_s, a in db.execute(
            select(BestEffort.time_s, Activity)
            .join(Activity, Activity.id == BestEffort.activity_id)
            .where(BestEffort.user_id == user_id, BestEffort.distance_key == key, Activity.sport == "run")
        ).all():
            found.append((a, time_s))
    elif key == "longest":
        for a in db.scalars(
            select(Activity).where(
                Activity.user_id == user_id, Activity.sport == "ride", Activity.distance_m > 0
            )
        ):
            found.append((a, a.distance_m or 0.0))
    else:
        duration = key.removeprefix("power_")
        for a, curve in db.execute(
            select(Activity, ActivityMetrics.power_curve)
            .join(ActivityMetrics, ActivityMetrics.activity_id == Activity.id)
            .where(
                Activity.user_id == user_id,
                Activity.sport == "ride",
                ActivityMetrics.power_curve.is_not(None),
            )
        ).all():
            if curve and duration in curve:
                found.append((a, curve[duration]))
    out = [
        BestOut(activity_id=a.id, name=a.name, day=local_day(a.start_utc, a.timezone), value=round(v, 2))
        for a, v in found
    ]
    return sorted(out, key=lambda b: (b.day, b.activity_id))


def lower_is_better(key: str) -> bool:
    return key in m.RUN_DISTANCES


@router.get("/bests", operation_id="getBests")
def bests(
    db: DbSession,
    user: CurrentUser,
    key: Annotated[str, Query(description="A run distance (5k…), power_30… or longest")],
) -> list[BestOut]:
    """Every activity's best at one measure, oldest first: a run distance's time, a ride's best power
    over a duration or a ride's distance (Progress → Best times)."""
    if key not in BEST_KEYS:
        raise HTTPException(status_code=422, detail="Unknown best")
    return _bests(db, user.id, key)


class Medal(BaseModel):
    key: str
    activity_id: int
    day: date
    value: float
    rank: int = Field(description="1 to 3")
    scope: Literal["all", "year"] = Field(description="Of all time, or of its year")


def medal_of(
    entries: list[BestOut], entry: BestOut, lower: bool
) -> tuple[int, Literal["all", "year"]] | None:
    """An entry's place: in the top three of all time, or else of its year; None when neither."""

    def rank(pool: list[BestOut]) -> int:
        return 1 + sum(1 for b in pool if (b.value < entry.value if lower else b.value > entry.value))

    overall = rank(entries)
    if overall <= 3:
        return overall, "all"
    yearly = rank([b for b in entries if b.day.year == entry.day.year])
    return (yearly, "year") if yearly <= 3 else None


@router.get("/bests/recent", operation_id="getRecentBests")
def recent_bests(
    db: DbSession, user: CurrentUser, days: Annotated[int, Query(ge=1, le=366)] = 30
) -> list[Medal]:
    """The medals of the last days: bests in the top three of all time or of their year, all-time and
    better places first (Progress → Best times' card)."""
    since = datetime.now(UTC).date() - timedelta(days=days)
    medals: list[Medal] = []
    for key in BEST_KEYS:
        entries = _bests(db, user.id, key)
        for entry in entries:
            if entry.day < since:
                continue
            place = medal_of(entries, entry, lower_is_better(key))
            if place:
                medals.append(
                    Medal(
                        key=key,
                        activity_id=entry.activity_id,
                        day=entry.day,
                        value=entry.value,
                        rank=place[0],
                        scope=place[1],
                    )
                )
    medals.sort(key=lambda x: (x.scope != "all", x.rank, -x.day.toordinal()))
    return medals
