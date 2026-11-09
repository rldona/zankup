"""Month and year in review (OS-413) and how our metrics compare with Strava's (OS-323).

The review gathers a month or a year: totals against the previous period, active days and the
longest streak, the longest, hardest and hilliest activities, the records set, the most used gear and
the volume per day (month) or per month (year). The app shows it as a sequence of cards.

The comparison uses what a Strava export carried for each activity (`activities.strava`, OS-406):
Strava's Relative Effort against our TRIMP, its calories against ours and its grade-adjusted distance
against ours (Minetti). For each: how many activities, R², the mean absolute error, the ratio of the
means, the points of a scatter chart and the activities that differ the most. Each of our metrics
keeps its own formula; this only measures how close they are.

The optional "Strava-like effort scale" fits Strava's effort as a linear combination of the minutes
spent in each heart-rate zone, from this person's own data only, and shows the coefficients.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from datetime import date, timedelta
from typing import Annotated, Literal

from fastapi import HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from zankup.api.routing import protected_router
from zankup.api.stats import Totals, _activities, _add, _next
from zankup.auth.deps import CurrentUser, DbSession
from zankup.db.models import Activity, ActivityMetrics, BestEffort, Gear
from zankup.engine.user import local_day

router = protected_router(prefix="/api/stats", tags=["stats"])


# --- review ----------------------------------------------------------------------------------------


class ReviewActivity(BaseModel):
    id: int
    name: str | None
    sport: str
    day: date
    distance_m: float | None
    moving_s: float
    ascent_m: float | None
    load: float | None


class ReviewRecord(BaseModel):
    distance_key: str
    time_s: float
    activity_id: int
    day: date
    previous_s: float | None = Field(description="The record it beat, if any")


class ReviewGear(BaseModel):
    id: int
    name: str
    kind: str
    distance_m: float
    count: int


class ReviewBucket(BaseModel):
    start: date
    distance_m: float
    moving_s: float
    count: int


class Review(BaseModel):
    period: Literal["month", "year"]
    start: date
    end: date = Field(description="Exclusive")
    totals: Totals
    previous: Totals = Field(description="The month or year before")
    by_sport: dict[str, Totals]
    active_days: int
    longest_streak: int = Field(description="Most consecutive days with an activity")
    longest: ReviewActivity | None
    hardest: ReviewActivity | None
    hilliest: ReviewActivity | None
    records: list[ReviewRecord]
    gear: list[ReviewGear]
    buckets: list[ReviewBucket] = Field(description="Per day for a month, per month for a year")
    photos: int


def _bounds(period: str, value: str) -> tuple[date, date]:
    try:
        if period == "year":
            start = date(int(value), 1, 1)
            return start, date(start.year + 1, 1, 1)
        year, month = (int(p) for p in value.split("-"))
        start = date(year, month, 1)
    except (ValueError, TypeError):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Use YYYY for a year or YYYY-MM for a month"
        ) from None
    return start, _next(start, "month")


def _item(activity: Activity, metrics: ActivityMetrics | None) -> ReviewActivity:
    return ReviewActivity(
        id=activity.id,
        name=activity.name,
        sport=activity.sport,
        day=local_day(activity.start_utc, activity.timezone),
        distance_m=activity.distance_m,
        moving_s=activity.moving_s or activity.duration_s,
        ascent_m=activity.ascent_m,
        load=metrics.trimp if metrics else None,
    )


@router.get("/review", operation_id="getReview")
def review(
    db: DbSession,
    user: CurrentUser,
    period: Literal["month", "year"] = "month",
    value: Annotated[str, Query(description="YYYY-MM for a month, YYYY for a year")] = "",
) -> Review:
    """A month or a year in review."""
    if not value:
        today = date.today()
        value = f"{today.year}" if period == "year" else f"{today:%Y-%m}"
    start, end = _bounds(period, value)
    before = date(start.year - 1, 1, 1) if period == "year" else (start - timedelta(days=1)).replace(day=1)
    rows = _activities(db, user.id, start, end, None)
    totals, previous = Totals(), Totals()
    by_sport: dict[str, Totals] = defaultdict(Totals)
    days: set[date] = set()
    buckets: dict[date, ReviewBucket] = {}
    cursor = start
    unit = "day" if period == "month" else "month"
    while cursor < end:
        buckets[cursor] = ReviewBucket(start=cursor, distance_m=0, moving_s=0, count=0)
        cursor = _next(cursor, unit)
    for activity, metrics in rows:
        _add(totals, activity, metrics)
        _add(by_sport[activity.sport], activity, metrics)
        day = local_day(activity.start_utc, activity.timezone)
        days.add(day)
        bucket = buckets[day if period == "month" else day.replace(day=1)]
        bucket.distance_m += activity.distance_m or 0
        bucket.moving_s += activity.moving_s or activity.duration_s
        bucket.count += 1
    for activity, metrics in _activities(db, user.id, before, start, None):
        _add(previous, activity, metrics)

    streak = best = 0
    previous_day: date | None = None
    for day in sorted(days):
        streak = streak + 1 if previous_day is not None and day - previous_day == timedelta(days=1) else 1
        best, previous_day = max(best, streak), day

    def top(key: Callable[[Activity, ActivityMetrics | None], float]) -> ReviewActivity | None:
        candidates = [(a, m) for a, m in rows if key(a, m)]
        if not candidates:
            return None
        a, m = max(candidates, key=lambda r: key(*r))
        return _item(a, m)

    records = _records(db, user.id, start, end)
    ids = [a.id for a, _ in rows]
    gear_use: dict[int, list[float]] = defaultdict(lambda: [0.0, 0])
    for activity, _ in rows:
        if activity.gear_id:
            gear_use[activity.gear_id][0] += activity.distance_m or 0
            gear_use[activity.gear_id][1] += 1
    gear = []
    if gear_use:
        names = {g.id: g for g in db.scalars(select(Gear).where(Gear.id.in_(list(gear_use))))}
        for gear_id, (distance, count) in sorted(gear_use.items(), key=lambda kv: -kv[1][0])[:3]:
            if gear_id in names:
                g = names[gear_id]
                gear.append(
                    ReviewGear(id=g.id, name=g.name, kind=g.kind, distance_m=distance, count=int(count))
                )
    from zankup.db.models import Photo

    photos = len(db.scalars(select(Photo.id).where(Photo.activity_id.in_(ids))).all()) if ids else 0
    return Review(
        period=period,
        start=start,
        end=end,
        totals=totals,
        previous=previous,
        by_sport=dict(by_sport),
        active_days=len(days),
        longest_streak=best,
        longest=top(lambda a, m: a.distance_m or 0),
        hardest=top(lambda a, m: (m.trimp if m else 0) or 0),
        hilliest=top(lambda a, m: a.ascent_m or 0),
        records=records,
        gear=gear,
        buckets=list(buckets.values()),
        photos=photos,
    )


def _records(db: DbSession, user_id: int, start: date, end: date) -> list[ReviewRecord]:
    """All-time records set during the period, each with the one it beat."""
    rows = db.execute(
        select(BestEffort, Activity.start_utc, Activity.timezone)
        .join(Activity, Activity.id == BestEffort.activity_id)
        .where(BestEffort.user_id == user_id)
        .order_by(Activity.start_utc)
    ).all()
    best: dict[str, float] = {}
    out: dict[str, ReviewRecord] = {}
    for effort, started, timezone in rows:
        day = local_day(started, timezone)
        key = effort.distance_key
        if key not in best or effort.time_s < best[key]:
            if start <= day < end and key in best:
                beaten = out[key].previous_s if key in out else best[key]
                out[key] = ReviewRecord(
                    distance_key=key,
                    time_s=effort.time_s,
                    activity_id=effort.activity_id,
                    day=day,
                    previous_s=beaten,
                )
            best[key] = effort.time_s
    return sorted(out.values(), key=lambda r: r.time_s)


# --- comparison with Strava (OS-323) ----------------------------------------------------------------


class ComparisonPoint(BaseModel):
    activity_id: int
    ours: float
    strava: float


class MetricComparison(BaseModel):
    metric: Literal["effort", "calories", "grade_adjusted_distance"]
    count: int
    r2: float | None = Field(description="Coefficient of determination of ours against Strava's")
    mae: float | None = Field(description="Mean absolute error, in the metric's unit")
    ratio: float | None = Field(description="Mean of ours over mean of Strava's")
    points: list[ComparisonPoint] = Field(description="Up to 1000, for a scatter chart")
    largest: list[ComparisonPoint] = Field(description="The ten that differ the most")


class EffortScale(BaseModel):
    coefficients: list[float] = Field(description="Effort points per minute in each HR zone (Z1-Z5)")
    r2: float | None
    count: int


class Comparison(BaseModel):
    metrics: list[MetricComparison]
    effort_scale: EffortScale | None


def r_squared(ours: list[float], theirs: list[float]) -> float | None:
    """1 - SS_res/SS_tot, with Strava's values as the reference."""
    if len(theirs) < 3:
        return None
    mean = sum(theirs) / len(theirs)
    total = sum((t - mean) ** 2 for t in theirs)
    if total == 0:
        return None
    residual = sum((o - t) ** 2 for o, t in zip(ours, theirs, strict=True))
    return 1 - residual / total


def least_squares(rows: list[list[float]], targets: list[float]) -> list[float] | None:
    """Solve the normal equations (no intercept) by Gaussian elimination."""
    n = len(rows[0]) if rows else 0
    if len(rows) <= n or n == 0:
        return None
    a = [
        [sum(r[i] * r[j] for r in rows) for j in range(n)]
        + [sum(r[i] * t for r, t in zip(rows, targets, strict=True))]
        for i in range(n)
    ]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(a[r][col]))
        if abs(a[pivot][col]) < 1e-12:
            return None
        a[col], a[pivot] = a[pivot], a[col]
        for r in range(n):
            if r != col:
                f = a[r][col] / a[col][col]
                a[r] = [x - f * y for x, y in zip(a[r], a[col], strict=True)]
    return [a[i][n] / a[i][i] for i in range(n)]


def _compare(
    metric: Literal["effort", "calories", "grade_adjusted_distance"], pairs: list[tuple[int, float, float]]
) -> MetricComparison:
    ours = [p[1] for p in pairs]
    theirs = [p[2] for p in pairs]
    points = [ComparisonPoint(activity_id=i, ours=round(o, 2), strava=round(t, 2)) for i, o, t in pairs]
    return MetricComparison(
        metric=metric,
        count=len(pairs),
        r2=r_squared(ours, theirs),
        mae=sum(abs(o - t) for o, t in zip(ours, theirs, strict=True)) / len(pairs) if pairs else None,
        ratio=(sum(ours) / sum(theirs)) if pairs and sum(theirs) else None,
        points=points[:1000],
        largest=sorted(points, key=lambda p: -abs(p.ours - p.strava))[:10],
    )


@router.get("/strava-comparison", operation_id="getStravaComparison")
def strava_comparison(db: DbSession, user: CurrentUser) -> Comparison:
    """Our effort, calories and grade-adjusted distance against what Strava computed (OS-323)."""
    rows = db.execute(
        select(Activity, ActivityMetrics)
        .join(ActivityMetrics, ActivityMetrics.activity_id == Activity.id)
        .where(Activity.user_id == user.id, Activity.strava.is_not(None))
    ).all()
    effort, calories, gad = [], [], []
    zone_rows: list[list[float]] = []
    zone_targets: list[float] = []
    for activity, metrics in rows:
        refs = activity.strava or {}
        relative = refs.get("relative_effort")
        if relative and metrics.trimp:
            effort.append((activity.id, metrics.trimp, float(relative)))
        ours_kcal = activity.calories if activity.calories is not None else metrics.calories
        if refs.get("calories") and ours_kcal:
            calories.append((activity.id, float(ours_kcal), float(refs["calories"])))
        if refs.get("grade_adjusted_distance") and metrics.gap_distance_m:
            gad.append((activity.id, metrics.gap_distance_m, float(refs["grade_adjusted_distance"])))
        zones = metrics.hr_zones
        if relative and isinstance(zones, list) and len(zones) == 5:
            zone_rows.append([float(s) / 60 for s in zones])
            zone_targets.append(float(relative))
    scale = None
    coefficients = least_squares(zone_rows, zone_targets) if len(zone_rows) >= 20 else None
    if coefficients is not None:
        fitted = [sum(c * x for c, x in zip(coefficients, r, strict=True)) for r in zone_rows]
        scale = EffortScale(
            coefficients=[round(c, 4) for c in coefficients],
            r2=r_squared(fitted, zone_targets),
            count=len(zone_rows),
        )
    return Comparison(
        metrics=[
            _compare("effort", effort),
            _compare("calories", calories),
            _compare("grade_adjusted_distance", gad),
        ],
        effort_scale=scale,
    )
