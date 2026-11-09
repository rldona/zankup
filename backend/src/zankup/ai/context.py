"""What the model is allowed to see (OS-702): aggregated numbers, never where or who.

Every context is a plain dict of numbers, dates and sport names. No coordinates, routes, device names,
activity names or descriptions (Garmin's names carry the town), photos, e-mail or profile data
(birth date, sex, weight, height) ever get in: `assert_minimised` refuses them, and the tests check
it against activities that have all of them.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from statistics import median
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from zankup.db.models import (
    Activity,
    ActivityMetrics,
    BestEffort,
    DailyLoad,
    EstimateRow,
    Event,
    Lap,
)
from zankup.engine.user import local_day

# Keys that must never appear in anything sent to the model.
FORBIDDEN_KEYS = frozenset(
    {
        "lat",
        "lon",
        "latitude",
        "longitude",
        "bbox",
        "route",
        "route_simplified",
        "polyline",
        "coordinates",
        "device",
        "name",
        "description",
        "email",
        "display_name",
        "location",
        "birth_date",
        "sex",
        "weight_kg",
        "height_cm",
        "raw_meta",
        "fit_path",
        "photo",
        "photos",
        "external_id",
        "weather",
        "privacy_zones",
    }
)
COMPARISON_DAYS = 90
MAX_SPLITS = 60
MAX_LAPS = 30


def assert_minimised(data: Any, path: str = "") -> None:
    """Raise if anything the model must not see is in `data` (checked on every context, cheaply)."""
    if isinstance(data, dict):
        for key, value in data.items():
            if str(key) in FORBIDDEN_KEYS:
                raise ValueError(f"{path}{key} must not reach the model")
            assert_minimised(value, f"{path}{key}.")
    elif isinstance(data, list | tuple):
        for index, item in enumerate(data):
            assert_minimised(item, f"{path}{index}.")


def _round(value: float | None, digits: int = 0) -> float | int | None:
    if value is None:
        return None
    return round(value, digits) if digits else round(value)


def _speed(distance_m: float | None, moving_s: float | None) -> float | None:
    if not distance_m or not moving_s:
        return None
    return round(distance_m / moving_s, 3)


def _median(values: list[float]) -> float | None:
    return round(median(values), 1) if values else None


# --- one activity (OS-703) ----------------------------------------------------------------------------


def activity_context(db: Session, activity: Activity, *, compare: bool = True) -> dict[str, Any]:
    """The numbers of one activity, with the metrics the engine computed and, if asked, how it compares
    with the person's usual for that sport in the previous 90 days."""
    metrics = db.get(ActivityMetrics, activity.id)
    day = local_day(activity.start_utc, activity.timezone)
    moving = activity.moving_s or activity.duration_s
    context: dict[str, Any] = {
        "activity_id": activity.id,
        "sport": activity.sport,
        "sub_sport": activity.sub_sport,
        "day": day.isoformat(),
        "weekday": day.strftime("%A"),
        "start_hour": (activity.start_utc + _offset(activity.timezone)).hour,
        "duration_s": _round(activity.duration_s),
        "moving_s": _round(moving),
        "distance_m": _round(activity.distance_m),
        "ascent_m": _round(activity.ascent_m),
        "descent_m": _round(activity.descent_m),
        "avg_speed_mps": _speed(activity.distance_m, moving),
        "avg_hr": activity.avg_hr,
        "max_hr": activity.max_hr,
        "avg_power_w": activity.avg_power,
        "normalized_power_w": activity.normalized_power,
        "calories": activity.calories,
        "training_effect": activity.training_effect,
        "has_gps": activity.has_gps,
    }
    if metrics is not None:
        context["metrics"] = {
            "relative_effort": _round(metrics.trimp, 1),
            "hr_zones_s": [round(z) for z in metrics.hr_zones] if metrics.hr_zones else None,
            "power_zones_s": [round(z) for z in metrics.power_zones] if metrics.power_zones else None,
            "grade_adjusted_distance_m": _round(metrics.gap_distance_m),
            "efficiency": _round(metrics.efficiency, 2),
            "decoupling_pct": _round(metrics.decoupling, 1),
        }
    if activity.splits:
        context["splits"] = [
            {
                "distance_m": _round(s.get("distance_m")),
                "time_s": _round(s.get("time_s")),
                "elevation_change_m": _round(s.get("elevation_change_m")),
                "avg_hr": s.get("avg_hr"),
            }
            for s in activity.splits[:MAX_SPLITS]
        ]
    laps = list(db.scalars(select(Lap).where(Lap.activity_id == activity.id).order_by(Lap.idx)))
    if len(laps) > 1:
        context["laps"] = {
            "count": len(laps),
            "items": [
                {
                    "duration_s": _round(lap.duration_s),
                    "distance_m": _round(lap.distance_m),
                    "avg_hr": lap.avg_hr,
                    "ascent_m": _round(lap.ascent_m),
                }
                for lap in laps[:MAX_LAPS]
            ],
        }
    if activity.sets:
        kinds: dict[str, int] = defaultdict(int)
        reps = 0
        for item in activity.sets:
            if item.get("kind") == "active":
                kinds[str(item.get("category") or "other")] += 1
                reps += int(item.get("reps") or 0)
        context["strength"] = {"sets": sum(kinds.values()), "reps": reps, "exercises": dict(kinds)}
    efforts = list(db.scalars(select(BestEffort).where(BestEffort.activity_id == activity.id)))
    if efforts:
        context["best_efforts"] = [
            {"distance": e.distance_key, "time_s": _round(e.time_s)}
            for e in sorted(efforts, key=lambda e: e.distance_m)
        ]
    records = list(
        db.scalars(
            select(Event).where(
                Event.user_id == activity.user_id,
                Event.kind == "record",
                Event.payload["activity_id"].as_integer() == activity.id,
            )
        )
    )
    if records:
        context["records_set"] = [
            {"distance": r.payload.get("distance_key"), "time_s": _round(r.payload.get("time_s"))}
            for r in records
        ]
    load = db.get(DailyLoad, (activity.user_id, day))
    if load is not None:
        context["form_that_day"] = {
            "fitness": _round(load.ctl, 1),
            "fatigue": _round(load.atl, 1),
            "form": _round(load.tsb, 1),
        }
    if compare:
        context["usual"] = _usual(db, activity)
    assert_minimised(context)
    return context


def _offset(timezone: str | None) -> timedelta:
    from zankup.engine.user import OFFSET

    match = OFFSET.match(timezone or "")
    if not match:
        return timedelta(0)
    sign = -1 if match.group(1) == "-" else 1
    return sign * timedelta(hours=int(match.group(2)), minutes=int(match.group(3)))


def _usual(db: Session, activity: Activity) -> dict[str, Any]:
    """Medians of the same sport in the 90 days before this activity."""
    rows = db.execute(
        select(Activity, ActivityMetrics)
        .outerjoin(ActivityMetrics, ActivityMetrics.activity_id == Activity.id)
        .where(
            Activity.user_id == activity.user_id,
            Activity.sport == activity.sport,
            Activity.id != activity.id,
            Activity.start_utc >= activity.start_utc - timedelta(days=COMPARISON_DAYS),
            Activity.start_utc < activity.start_utc,
        )
    ).all()
    distances = [a.distance_m for a, _ in rows if a.distance_m]
    movings = [(a.moving_s or a.duration_s) for a, _ in rows]
    hrs = [float(a.avg_hr) for a, _ in rows if a.avg_hr]
    speeds = [s for a, _ in rows if (s := _speed(a.distance_m, a.moving_s or a.duration_s))]
    efforts = [mt.trimp for _, mt in rows if mt is not None and mt.trimp]
    return {
        "days": COMPARISON_DAYS,
        "count": len(rows),
        "median_distance_m": _median(distances),
        "median_moving_s": _median(movings),
        "median_avg_hr": _median(hrs),
        "median_speed_mps": round(median(speeds), 3) if speeds else None,
        "median_relative_effort": _median(efforts),
    }


# --- one week (OS-704) --------------------------------------------------------------------------------


def _totals(rows: list[tuple[Activity, ActivityMetrics | None]]) -> dict[str, Any]:
    return {
        "count": len(rows),
        "distance_m": round(sum(a.distance_m or 0 for a, _ in rows)),
        "moving_s": round(sum((a.moving_s or a.duration_s) for a, _ in rows)),
        "ascent_m": round(sum(a.ascent_m or 0 for a, _ in rows)),
        "relative_effort": round(sum((mt.trimp if mt else 0) or 0 for _, mt in rows), 1),
    }


def _week_rows(
    db: Session, user_id: int, start: date, end: date
) -> list[tuple[Activity, ActivityMetrics | None]]:
    query = (
        select(Activity, ActivityMetrics)
        .outerjoin(ActivityMetrics, ActivityMetrics.activity_id == Activity.id)
        .where(
            Activity.user_id == user_id,
            Activity.start_utc >= datetime.combine(start - timedelta(days=1), datetime.min.time(), UTC),
            Activity.start_utc < datetime.combine(end + timedelta(days=1), datetime.min.time(), UTC),
        )
        .order_by(Activity.start_utc)
    )
    return [(a, mt) for a, mt in db.execute(query).all() if start <= local_day(a.start_utc, a.timezone) < end]


def weekly_context(db: Session, user_id: int, week_start: date, *, weeks_back: int = 12) -> dict[str, Any]:
    """The week that starts on `week_start` (a Monday): totals by sport, the previous weeks, the load
    curve, records, estimates and the week's sleep and recovery, all as numbers."""
    week_end = week_start + timedelta(days=7)
    rows = _week_rows(db, user_id, week_start, week_end)
    by_sport: dict[str, list[tuple[Activity, ActivityMetrics | None]]] = defaultdict(list)
    for a, mt in rows:
        by_sport[a.sport].append((a, mt))
    context: dict[str, Any] = {
        "week_start": week_start.isoformat(),
        "week_end": (week_end - timedelta(days=1)).isoformat(),
        "totals": _totals(rows),
        "by_sport": {sport: _totals(items) for sport, items in by_sport.items()},
        "activities": [
            {
                "activity_id": a.id,
                "day": local_day(a.start_utc, a.timezone).isoformat(),
                "sport": a.sport,
                "distance_m": _round(a.distance_m),
                "moving_s": _round(a.moving_s or a.duration_s),
                "ascent_m": _round(a.ascent_m),
                "avg_hr": a.avg_hr,
                "relative_effort": _round(mt.trimp, 1) if mt else None,
            }
            for a, mt in rows
        ],
        "previous_week": _totals(_week_rows(db, user_id, week_start - timedelta(days=7), week_start)),
        "previous_weeks": [
            {
                "week_start": start.isoformat(),
                **_totals(_week_rows(db, user_id, start, start + timedelta(days=7))),
            }
            for start in (week_start - timedelta(days=7 * n) for n in range(2, weeks_back + 1))
        ],
    }
    loads = list(
        db.scalars(
            select(DailyLoad)
            .where(DailyLoad.user_id == user_id, DailyLoad.day >= week_start, DailyLoad.day < week_end)
            .order_by(DailyLoad.day)
        )
    )
    if loads:
        context["load"] = [
            {
                "day": row.day.isoformat(),
                "load": _round(row.load, 1),
                "fitness": _round(row.ctl, 1),
                "fatigue": _round(row.atl, 1),
                "form": _round(row.tsb, 1),
            }
            for row in loads
        ]
    ids = [a.id for a, _ in rows]
    if ids:
        records = list(
            db.scalars(
                select(Event).where(
                    Event.user_id == user_id,
                    Event.kind == "record",
                    Event.payload["activity_id"].as_integer().in_(ids),
                )
            )
        )
        if records:
            context["records_set"] = [
                {
                    "activity_id": r.payload.get("activity_id"),
                    "distance": r.payload.get("distance_key"),
                    "time_s": _round(r.payload.get("time_s")),
                }
                for r in records
            ]
    estimates = list(
        db.scalars(select(EstimateRow).where(EstimateRow.user_id == user_id).order_by(EstimateRow.day))
    )
    if estimates:
        latest: dict[str, EstimateRow] = {}
        for row in estimates:
            latest[row.kind] = row
        context["estimates"] = {
            kind: {"value": _round(row.value, 1), "changed_this_week": week_start <= row.day < week_end}
            for kind, row in latest.items()
        }
    health = _health(db, user_id, week_start, week_end)
    if health:
        context["health"] = health
    assert_minimised(context)
    return context


def _health(db: Session, user_id: int, start: date, end: date) -> dict[str, Any] | None:
    from zankup.health import resolve

    days = resolve.days(db, user_id, start, end - timedelta(days=1))
    sleeps = [d.sleep.asleep_s for d in days if d.sleep is not None and d.sleep.asleep_s]
    scores = [d.sleep.score for d in days if d.sleep is not None and d.sleep.score is not None]
    hrv = [d.values["hrv"].value for d in days if "hrv" in d.values]
    resting = [d.values["resting_hr"].value for d in days if "resting_hr" in d.values]
    readiness = [d.readiness.score for d in days if d.readiness is not None]
    if not (sleeps or hrv or resting):
        return None
    return {
        "nights": len(sleeps),
        "avg_sleep_s": round(sum(sleeps) / len(sleeps)) if sleeps else None,
        "avg_sleep_score": round(sum(scores) / len(scores)) if scores else None,
        "avg_hrv_ms": round(sum(hrv) / len(hrv), 1) if hrv else None,
        "avg_resting_hr": round(sum(resting) / len(resting), 1) if resting else None,
        "avg_readiness": round(sum(readiness) / len(readiness)) if readiness else None,
    }
