"""The longer report on an activity, asked from its page ("Tell me more", as Strava's): the effort, the
activity told with its numbers, its place in the month (volume, goals) and a verdict, ending with one
concrete recommendation for the next session. Generated on request and kept, like the summary.

Two things Strava's does not: it never contradicts itself, and it closes with a recommendation.
Comparisons are worked out here, not by the model: each says against which baseline (the usual of the
last 90 days, the earlier attempts on the same route) and in which direction, and the model may only
state those. When two baselines disagree, it has to say so in one sentence, naming both.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from statistics import median
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from zankup.ai.client import Llm
from zankup.ai.context import activity_context, assert_minimised
from zankup.ai.summary import LANGUAGES, settings_of
from zankup.db.models import Activity, ActivityMetrics, ActivityReport, DailyLoad, Goal
from zankup.engine import METRICS_VERSION
from zankup.engine.user import local_day

SYSTEM = """You write the detailed report on one activity in Zankup, a personal sports data app, shown \
when the person taps "Tell me more" under the activity's short summary. You receive the activity as \
JSON: its numbers, the metrics the app computed, how it compares with baselines ("comparisons"), the \
month so far, the person's goals, their load in the last days and their form that day.

Write for the person who did it, in the language and units you are told, as a coach who knows their \
data: warm and direct, never gushing. Give, as separate fields:
- headline: one sentence, the gist (at most 140 characters).
- effort: how hard it was (relative effort against their usual, heart-rate or power zones).
- story: the activity told with its numbers (distance, time, pace or power, splits, the route).
- month: its place in the month so far (volume against the same days of last month, goals, streak).
- verdict: one or two sentences that weigh it all up.
- next: one concrete recommendation for the next session: the kind of session, its duration or \
distance and its intensity (a zone or an effort), and why, from their form and recent load. Never \
medical advice.

Rules that matter more than style:
1. Every comparison comes from "comparisons": say its baseline ("your usual of the last 90 days", \
"your earlier times on this route") and its direction exactly as given. Never state a direction that \
is not there, and never the opposite one.
2. If two comparisons of the same measure point different ways (faster than usual but slower than on \
this route), say both in one sentence, naming each baseline. Never in separate places.
3. Use only the numbers you are given, rounded sensibly; never invent a number, a place, a cause or a \
feeling. If something is missing, leave it out.
4. No greetings, no emoji, no exclamation marks. Distances in km or miles with one decimal, paces as \
min/km or min/mile, times as h:mm:ss or mm:ss."""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "headline": {"type": "string"},
        "effort": {"type": "string"},
        "story": {"type": "string"},
        "month": {"type": "string"},
        "verdict": {"type": "string"},
        "next": {"type": "string"},
    },
    "required": ["headline", "effort", "story", "month", "verdict", "next"],
    "additionalProperties": False,
}
FIELDS = ("headline", "effort", "story", "month", "verdict", "next")

# How far a value has to be from its baseline to be more than "similar".
SPEED_MARGIN = 0.02  # 2 % of the speed: about 7 s/km at 6:00/km
EFFORT_MARGIN = 0.10
HR_MARGIN = 3.0  # bpm
DISTANCE_MARGIN = 0.10


def compare(
    measure: str,
    value: float | None,
    baseline: str,
    base: float | None,
    margin: float,
    absolute: bool = False,
) -> dict[str, Any] | None:
    """One comparison, with its direction worked out here: higher, lower or similar."""
    if value is None or base is None or base <= 0:
        return None
    gap = value - base if absolute else (value - base) / base
    direction = "similar" if abs(gap) <= margin else "higher" if gap > 0 else "lower"
    return {
        "measure": measure,
        "value": round(value, 3),
        "baseline": baseline,
        "baseline_value": round(base, 3),
        "direction": direction,
    }


# Each measure: where its value is, its median's name in a baseline, its margin and whether absolute.
MEASURES = (
    ("speed", "avg_speed_mps", "median_speed_mps", SPEED_MARGIN, False),
    ("relative_effort", "relative_effort", "median_relative_effort", EFFORT_MARGIN, False),
    ("avg_hr", "avg_hr", "median_avg_hr", HR_MARGIN, True),
    ("distance", "distance_m", "median_distance_m", DISTANCE_MARGIN, False),
)


def comparisons(context: dict[str, Any], route: dict[str, Any] | None) -> list[dict[str, Any]]:
    """The activity against its usual of 90 days and, when it has one, its route's earlier attempts.
    Speed is in m/s: "higher" is faster."""
    metrics = context.get("metrics") or {}
    baselines = [("usual_90_days", context.get("usual") or {})]
    if route:
        baselines.append(("same_route", route))
    found = []
    for name, base in baselines:
        for measure, key, median_key, margin, absolute in MEASURES:
            value = metrics.get(key) if key == "relative_effort" else context.get(key)
            found.append(compare(measure, value, name, base.get(median_key), margin, absolute))
    return [c for c in found if c is not None]


def _route(db: Session, activity: Activity) -> dict[str, Any] | None:
    """The earlier attempts on the same matched route: how many and their medians."""
    mine = db.get(ActivityMetrics, activity.id)
    if mine is None or mine.route_group is None:
        return None
    rows = db.execute(
        select(Activity, ActivityMetrics)
        .join(ActivityMetrics, ActivityMetrics.activity_id == Activity.id)
        .where(
            ActivityMetrics.user_id == activity.user_id,
            ActivityMetrics.route_group == mine.route_group,
            Activity.start_utc < activity.start_utc,
        )
    ).all()
    if not rows:
        return None
    speeds = [
        a.distance_m / (a.moving_s or a.duration_s)
        for a, _ in rows
        if a.distance_m and (a.moving_s or a.duration_s)
    ]
    efforts = [mt.trimp for _, mt in rows if mt.trimp]
    return {
        "earlier_attempts": len(rows),
        "this_attempt_number": len(rows) + 1,
        "median_speed_mps": round(median(speeds), 3) if speeds else None,
        "median_relative_effort": round(median(efforts), 1) if efforts else None,
    }


def _span_totals(db: Session, user_id: int, start: date, end: date, sport: str) -> dict[str, Any]:
    rows = [
        a
        for a in db.scalars(
            select(Activity).where(
                Activity.user_id == user_id,
                Activity.start_utc >= datetime.combine(start - timedelta(days=1), datetime.min.time(), UTC),
                Activity.start_utc < datetime.combine(end + timedelta(days=1), datetime.min.time(), UTC),
            )
        )
        if start <= local_day(a.start_utc, a.timezone) < end
    ]
    same = [a for a in rows if a.sport == sport]
    return {
        "activities": len(rows),
        "moving_s": round(sum(a.moving_s or a.duration_s for a in rows)),
        "same_sport_activities": len(same),
        "same_sport_distance_m": round(sum(a.distance_m or 0 for a in same)),
        "same_sport_moving_s": round(sum(a.moving_s or a.duration_s for a in same)),
        "sports": sorted({a.sport for a in rows}),
    }


def _month(db: Session, activity: Activity, day: date) -> dict[str, Any]:
    """The month up to the activity's day, against the same days of the month before."""
    start = day.replace(day=1)
    end = day + timedelta(days=1)
    before_start = (start - timedelta(days=1)).replace(day=1)
    before_end = min(before_start + (end - start), start)
    return {
        "month": start.strftime("%Y-%m"),
        "days_in": (end - start).days,
        "so_far": _span_totals(db, activity.user_id, start, end, activity.sport),
        "same_days_last_month": _span_totals(db, activity.user_id, before_start, before_end, activity.sport),
    }


def _goals(db: Session, activity: Activity, day: date) -> list[dict[str, Any]]:
    """The person's goals, where they stand as of the activity's day."""
    from zankup.api.training import _goal_out

    out = []
    for goal in db.scalars(select(Goal).where(Goal.user_id == activity.user_id).order_by(Goal.id)):
        g = _goal_out(db, goal, day)
        out.append(
            {
                "period": g.period,
                "metric": g.metric,
                "sport": g.sport,
                "target": round(g.target),
                "current": round(g.current),
                "percent": round(100 * g.current / g.target) if g.target else None,
                "period_start": g.start.isoformat(),
                "period_end": g.end.isoformat(),
            }
        )
    return out


def _recent_load(db: Session, user_id: int, day: date) -> dict[str, Any]:
    """The last seven days' load and the days since the last rest day, for the recommendation."""
    rows = list(
        db.scalars(
            select(DailyLoad)
            .where(
                DailyLoad.user_id == user_id, DailyLoad.day > day - timedelta(days=7), DailyLoad.day <= day
            )
            .order_by(DailyLoad.day)
        )
    )
    return {
        "last_7_days_load": round(sum(r.load for r in rows), 1),
        "days_with_training": sum(1 for r in rows if r.load > 0),
    }


def report_context(db: Session, activity: Activity) -> dict[str, Any]:
    context = activity_context(db, activity)
    day = date.fromisoformat(context["day"])
    route = _route(db, activity)
    if route:
        context["route"] = route
    context["comparisons"] = comparisons(context, route)
    context["month"] = _month(db, activity, day)
    context["goals"] = _goals(db, activity, day)
    context["recent_load"] = _recent_load(db, activity.user_id, day)
    assert_minimised(context)
    return context


def generate_report(db: Session, llm: Llm, activity: Activity) -> ActivityReport:
    """Ask the model and keep (or replace) the activity's report."""
    import json

    language, units = settings_of(db, activity.user_id)
    context = report_context(db, activity)
    completion = llm.complete(
        db,
        activity.user_id,
        "report",
        system=SYSTEM,
        messages=[
            {
                "role": "user",
                "content": (
                    f"Language: {LANGUAGES.get(language, 'English')}. Units: {units}.\n"
                    f"Activity:\n{json.dumps(context, ensure_ascii=False, separators=(',', ':'))}"
                ),
            }
        ],
        output_schema=SCHEMA,
        max_tokens=2500,
        effort="low",
    )
    data = completion.json()
    row = db.get(ActivityReport, activity.id)
    if row is None:
        row = ActivityReport(activity_id=activity.id, user_id=activity.user_id)
        db.add(row)
    row.language = language
    row.sections = {f: str(data.get(f) or "").strip() for f in FIELDS}
    row.model = llm.model
    row.metrics_version = METRICS_VERSION
    row.created_at = datetime.now(UTC)
    db.flush()
    return row
