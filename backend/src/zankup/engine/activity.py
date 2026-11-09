"""Per-activity metrics (OS-302, OS-305, OS-306, OS-312, OS-324): effort, zones, grade-adjusted
distance, calories, efficiency, decoupling and the best-effort curves, from the stored series."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

import zankup_metrics as m
from zankup.db.models import Activity, ActivityMetrics, BestEffort, Event, Stream
from zankup.engine import METRICS_VERSION
from zankup.engine.athlete import Athlete
from zankup.fit.streams import decode_streams

PACE_SPORTS = {"run", "walk"}
SPEED_SPORTS = {"run", "walk", "ride", "row", "swim"}


def _curve(curve: dict[int, float]) -> dict[str, float] | None:
    return {str(k): round(v, 3) for k, v in curve.items()} or None


def has(values: list[Any] | None) -> bool:
    return values is not None and any(v is not None for v in values)


def compute(activity: Activity, series: dict[str, list[Any]] | None, who: Athlete) -> dict[str, Any]:
    """The metrics of one activity as column values (no database access)."""
    t: list[float] = series.get("t", []) if series else []
    hr = series.get("hr") if series else None
    power = series.get("power") if series else None
    dist = series.get("dist") if series else None
    alt = series.get("alt") if series else None
    moving = activity.moving_s or activity.duration_s

    values: dict[str, Any] = {
        "trimp": None,
        "hr_zones": None,
        "power_zones": None,
        "gap_distance_m": None,
        "calories": None,
        "efficiency": None,
        "decoupling": None,
        "power_curve": None,
        "speed_curve": None,
        "hr_curve": None,
    }
    if t and has(hr):
        assert hr is not None
        values["trimp"] = round(m.trimp(t, hr, who.hr_max, who.hr_rest, who.sex), 2)
        bounds = m.hr_zones(who.zone_method, who.hr_max, who.hr_rest, who.lthr)
        values["hr_zones"] = [round(s, 1) for s in m.time_in_zones(t, hr, bounds)]
        values["hr_curve"] = _curve(m.hr_curve(t, hr))
    elif activity.avg_hr and moving:
        # No series (manual or summary-only): TRIMP from the average, as one steady effort.
        values["trimp"] = round(
            m.trimp(
                [0.0, float(moving)], [activity.avg_hr, None], who.hr_max, who.hr_rest, who.sex, max_gap_s=1e9
            ),
            2,
        )
    if t and has(power):
        assert power is not None
        values["power_curve"] = _curve(m.power_curve(t, power))
        if who.ftp:
            values["power_zones"] = [round(s, 1) for s in m.time_in_zones(t, power, m.power_zones(who.ftp))]
    if t and has(dist) and activity.sport in SPEED_SPORTS:
        assert dist is not None
        values["speed_curve"] = _curve(m.speed_curve(t, dist))
        if activity.sport in PACE_SPORTS and has(alt):
            assert alt is not None
            gap = m.gap_distance(dist, alt)
            values["gap_distance_m"] = round(gap, 1) if gap else None
        if has(hr):
            assert hr is not None
            decoupling = m.decoupling(t, dist, hr)
            values["decoupling"] = round(decoupling, 2) if decoupling is not None else None
    if activity.distance_m and activity.avg_hr and moving and activity.sport in SPEED_SPORTS:
        efficiency = m.efficiency(activity.distance_m, moving, activity.avg_hr)
        values["efficiency"] = round(efficiency, 4) if efficiency else None
    if activity.calories is None and moving:
        kcal = m.calories(activity.sport, moving / 60, activity.avg_hr, who.weight_kg, who.age, who.sex)
        values["calories"] = round(kcal) if kcal else None
    return values


def series_of(db: Session, activity_id: int) -> dict[str, list[Any]] | None:
    data = db.scalar(select(Stream.data).where(Stream.activity_id == activity_id))
    return decode_streams(data) if data else None


def update_activity(db: Session, activity: Activity, who: Athlete) -> ActivityMetrics:
    """Compute and store one activity's metrics (keeping its matched route)."""
    values = compute(activity, series_of(db, activity.id), who)
    statement = insert(ActivityMetrics).values(
        activity_id=activity.id,
        user_id=activity.user_id,
        metrics_version=METRICS_VERSION,
        computed_at=datetime.now(UTC),
        **values,
    )
    db.execute(
        statement.on_conflict_do_update(
            index_elements=["activity_id"],
            set_={**values, "metrics_version": METRICS_VERSION, "computed_at": datetime.now(UTC)},
        )
    )
    return db.get_one(ActivityMetrics, activity.id)


def record_events(db: Session, activity: Activity) -> int:
    """A "record" event for each best effort of this activity that is the fastest ever (OS-304)."""
    count = 0
    for effort in db.scalars(select(BestEffort).where(BestEffort.activity_id == activity.id)):
        faster = db.scalar(
            select(func.count())
            .select_from(BestEffort)
            .join(Activity, Activity.id == BestEffort.activity_id)
            .where(
                BestEffort.user_id == activity.user_id,
                BestEffort.distance_key == effort.distance_key,
                BestEffort.activity_id != activity.id,
                BestEffort.time_s <= effort.time_s,
                Activity.start_utc < activity.start_utc,
            )
        )
        earlier = db.scalar(
            select(func.count())
            .select_from(BestEffort)
            .join(Activity, Activity.id == BestEffort.activity_id)
            .where(
                BestEffort.user_id == activity.user_id,
                BestEffort.distance_key == effort.distance_key,
                Activity.start_utc < activity.start_utc,
            )
        )
        if not faster and earlier:  # a record only means something once there is something to beat
            db.execute(
                insert(Event)
                .values(
                    user_id=activity.user_id,
                    kind="record",
                    payload={
                        "activity_id": activity.id,
                        "distance_key": effort.distance_key,
                        "time_s": effort.time_s,
                    },
                    dedupe_key=f"record:{activity.id}:{effort.distance_key}",
                )
                .on_conflict_do_nothing(index_elements=["dedupe_key"])
            )
            count += 1
    return count
