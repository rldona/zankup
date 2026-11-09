"""What depends on the whole history (OS-303, OS-304, OS-307, OS-309, OS-316, OS-319): daily load
and form, the estimates and their source activities, matched routes and the engine's events."""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

import zankup_metrics as m
from zankup.db.models import Activity, ActivityMetrics, BestEffort, DailyLoad, EstimateRow, Event
from zankup.engine import METRICS_VERSION
from zankup.fit.streams import decode_polyline

OFFSET = re.compile(r"^([+-])(\d{2}):(\d{2})$")
ESTIMATE_WINDOW = timedelta(days=90)
RISING = {"ftp", "critical_speed", "vdot"}  # an "estimate up" event when these rise 2 % or more
ROUTE_SPORTS = ("run", "walk", "ride")


def local_day(start: datetime, timezone: str | None) -> date:
    match = OFFSET.match(timezone or "")
    if not match:
        return start.date()
    sign = -1 if match.group(1) == "-" else 1
    return (start + sign * timedelta(hours=int(match.group(2)), minutes=int(match.group(3)))).date()


def update_daily_load(db: Session, user_id: int, today: date) -> list[m.DailyLoad]:
    """Rewrite the user's daily load and fitness from their first activity to today."""
    rows = db.execute(
        select(Activity.start_utc, Activity.timezone, ActivityMetrics.trimp)
        .join(ActivityMetrics, ActivityMetrics.activity_id == Activity.id)
        .where(Activity.user_id == user_id, ActivityMetrics.trimp.is_not(None))
    ).all()
    loads: dict[date, float] = defaultdict(float)
    for start, timezone, trimp in rows:
        loads[local_day(start, timezone)] += trimp or 0.0
    db.execute(delete(DailyLoad).where(DailyLoad.user_id == user_id))
    series = m.fitness(dict(loads), today) if loads else []
    if series:
        db.execute(
            insert(DailyLoad),
            [
                {
                    "user_id": user_id,
                    "day": d.day,
                    "load": round(d.load, 2),
                    "ctl": round(d.ctl, 3),
                    "atl": round(d.atl, 3),
                    "tsb": round(d.tsb, 3),
                }
                for d in series
            ],
        )
    return series


def _best(curves: list[tuple[int, dict[str, float]]], duration: int) -> tuple[float, int] | None:
    best: tuple[float, int] | None = None
    for activity_id, curve in curves:
        value = curve.get(str(duration))
        if value is not None and (best is None or value > best[0]):
            best = (value, activity_id)
    return best


def update_estimates(db: Session, user_id: int, today: date) -> dict[str, EstimateRow]:
    """Today's estimates from the last 90 days (max HR from the last year), each with its sources."""
    since = datetime.combine(today - ESTIMATE_WINDOW, datetime.min.time(), UTC)
    rows = db.execute(
        select(Activity.id, Activity.sport, ActivityMetrics.power_curve, ActivityMetrics.hr_curve)
        .join(ActivityMetrics, ActivityMetrics.activity_id == Activity.id)
        .where(Activity.user_id == user_id, Activity.start_utc >= since)
    ).all()
    power = [(r.id, r.power_curve) for r in rows if r.power_curve]
    hr_runs = [(r.id, r.hr_curve) for r in rows if r.hr_curve and r.sport == "run"]
    found: dict[str, tuple[float, str, list[int]]] = {}

    p20 = _best(power, 1200)
    if p20:
        found["ftp"] = (0.95 * p20[0], "ftp_20min", [p20[1]])
    else:
        p3, p12 = _best(power, 180), _best(power, 720)
        if p3 and p12:
            estimate = m.ftp({180: p3[0], 720: p12[0]})
            if estimate:
                found["ftp"] = (estimate.value, "ftp_critical_power", [p3[1], p12[1]])

    h60, h20 = _best(hr_runs, 3600), _best(hr_runs, 1200)
    if h60:
        found["lthr"] = (h60[0], "lthr_60min", [h60[1]])
    elif h20:
        found["lthr"] = (0.95 * h20[0], "lthr_20min", [h20[1]])

    efforts = db.execute(
        select(BestEffort.distance_m, BestEffort.time_s, BestEffort.activity_id)
        .join(Activity, Activity.id == BestEffort.activity_id)
        .where(BestEffort.user_id == user_id, Activity.start_utc >= since, Activity.sport == "run")
    ).all()
    best_by_distance: dict[float, tuple[float, int]] = {}
    for distance_m, time_s, activity_id in efforts:
        if distance_m not in best_by_distance or time_s < best_by_distance[distance_m][0]:
            best_by_distance[distance_m] = (time_s, activity_id)
    pairs = [(d, t) for d, (t, _) in best_by_distance.items()]
    cs = m.critical_speed(pairs)
    if cs:
        sources = [a for d, (t, a) in best_by_distance.items() if 180 <= t <= 1800]
        found["critical_speed"] = (
            cs.value,
            "critical_speed",
            sorted(set(sources)),
        )
    usable = [(d, t, a) for d, (t, a) in best_by_distance.items() if d >= 3000]
    if usable:
        d, t, a = max(usable, key=lambda e: m.vdot(e[0], e[1]))
        found["vdot"] = (m.vdot(d, t), f"vdot:{d / 1000:g}", [a])
        for key, target in m.RACES.items():
            found[f"race_{key}"] = (m.riegel(d, t, target), f"riegel:{d / 1000:g}", [a])

    year = datetime.combine(today - timedelta(days=365), datetime.min.time(), UTC)
    observed = db.execute(
        select(Activity.max_hr, Activity.id)
        .where(
            Activity.user_id == user_id,
            Activity.start_utc >= year,
            Activity.max_hr <= 230,
            Activity.max_hr >= 100,
        )
        .order_by(Activity.max_hr.desc())
        .limit(1)
    ).first()
    if observed and observed[0] is not None:
        found["hr_max"] = (float(observed[0]), "hr_max_year", [observed[1]])

    for kind, (value, method, sources) in found.items():
        previous = db.scalar(
            select(EstimateRow.value)
            .where(EstimateRow.user_id == user_id, EstimateRow.kind == kind, EstimateRow.day < today)
            .order_by(EstimateRow.day.desc())
            .limit(1)
        )
        db.execute(
            insert(EstimateRow)
            .values(
                user_id=user_id,
                kind=kind,
                day=today,
                value=round(value, 3),
                method=method,
                source_activity_ids=sources,
                metrics_version=METRICS_VERSION,
            )
            .on_conflict_do_update(
                index_elements=["user_id", "kind", "day"],
                set_={
                    "value": round(value, 3),
                    "method": method,
                    "source_activity_ids": sources,
                    "metrics_version": METRICS_VERSION,
                },
            )
        )
        if kind in RISING and previous and value >= previous * 1.02:
            _event(
                db,
                user_id,
                "estimate_up",
                f"estimate:{kind}:{today}",
                {"kind": kind, "value": value, "previous": previous},
            )
    return {
        r.kind: r
        for r in db.scalars(
            select(EstimateRow).where(EstimateRow.user_id == user_id, EstimateRow.day == today)
        )
    }


def _event(db: Session, user_id: int, kind: str, key: str, payload: dict[str, object]) -> None:
    db.execute(
        insert(Event)
        .values(user_id=user_id, kind=kind, payload=payload, dedupe_key=key)
        .on_conflict_do_nothing(index_elements=["dedupe_key"])
    )


def ramp_event(db: Session, user_id: int, series: list[m.DailyLoad]) -> None:
    """A warning when fitness rose more than 8 points in the last week: a risky ramp (OS-319)."""
    ramp = m.ramp(series)
    if ramp is not None and ramp > 8 and series:
        week = series[-1].day.isocalendar()
        _event(db, user_id, "ramp", f"ramp:{user_id}:{week.year}-{week.week}", {"ramp": round(ramp, 1)})


def update_routes(db: Session, user_id: int) -> int:
    """Put every activity with a track into a matched-route group (OS-309). Returns how many joined
    a group with at least one other activity."""
    rows = db.execute(
        select(Activity.id, Activity.sport, Activity.route_simplified, ActivityMetrics.route_group)
        .join(ActivityMetrics, ActivityMetrics.activity_id == Activity.id)
        .where(
            Activity.user_id == user_id,
            Activity.route_simplified.is_not(None),
            Activity.sport.in_(ROUTE_SPORTS),
        )
        .order_by(Activity.start_utc)
    ).all()
    routes = {r.id: decode_polyline(r.route_simplified) for r in rows}
    representatives: dict[str, list[int]] = defaultdict(list)  # sport → first activity of each group
    for r in rows:
        if r.route_group is not None and r.route_group == r.id:
            representatives[r.sport].append(r.id)
    joined = 0
    for r in rows:
        if r.route_group is not None:
            continue
        group = next((g for g in representatives[r.sport] if m.same_route(routes[g], routes[r.id])), None)
        if group is None:
            group = r.id
            representatives[r.sport].append(r.id)
        else:
            joined += 1
        db.execute(
            update(ActivityMetrics).where(ActivityMetrics.activity_id == r.id).values(route_group=group)
        )
    return joined


def update_user(db: Session, user_id: int, today: date | None = None) -> None:
    today = today or datetime.now(UTC).date()
    series = update_daily_load(db, user_id, today)
    ramp_event(db, user_id, series)
    update_estimates(db, user_id, today)
    update_routes(db, user_id)
