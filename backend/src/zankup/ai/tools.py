"""The Coach's tools (OS-705), also served by the MCP server (OS-709): what the model can ask about,
answered from the database with the same minimisation as the summaries (no coordinates, routes,
names or profile data). Each tool validates its arguments with a pydantic model, whose JSON schema
is what the model sees.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from zankup.ai.context import activity_context, assert_minimised
from zankup.db.models import Activity, ActivityMetrics, BestEffort, DailyLoad, EstimateRow
from zankup.engine.user import local_day

MAX_DAYS = 400
HEALTH_MAX_DAYS = 90


class ToolError(Exception):
    """Bad arguments or nothing found; the model gets the message and tries again."""


def _today() -> date:
    return datetime.now(UTC).date()


def _range(
    start: date | None, end: date | None, default_days: int, max_days: int = MAX_DAYS
) -> tuple[date, date]:
    end = end or _today() + timedelta(days=1)
    start = start or end - timedelta(days=default_days)
    if start >= end:
        raise ToolError("'from' must be before 'to'")
    if (end - start).days > max_days:
        raise ToolError(f"the period must be {max_days} days or shorter")
    return start, end


def _utc(day: date) -> datetime:
    return datetime.combine(day, datetime.min.time(), UTC)


def _speed(distance_m: float | None, moving_s: float | None) -> float | None:
    return round(distance_m / moving_s, 3) if distance_m and moving_s else None


# --- search_activities --------------------------------------------------------------------------------


class SearchArgs(BaseModel):
    """Activities in a period, newest first unless sorted otherwise."""

    sport: str | None = Field(None, description="run, ride, swim, walk, row, strength or other")
    from_day: date | None = Field(None, alias="from", description="First day, inclusive (YYYY-MM-DD)")
    to_day: date | None = Field(None, alias="to", description="Last day, exclusive (YYYY-MM-DD)")
    min_distance_km: float | None = Field(None, ge=0)
    max_distance_km: float | None = Field(None, ge=0)
    sort: Literal["date", "distance", "duration", "effort"] = "date"
    limit: int = Field(20, ge=1, le=50)

    model_config = {"populate_by_name": True}


def search_activities(db: Session, user_id: int, args: SearchArgs) -> dict[str, Any]:
    start, end = _range(args.from_day, args.to_day, default_days=90)
    query = (
        select(Activity, ActivityMetrics)
        .outerjoin(ActivityMetrics, ActivityMetrics.activity_id == Activity.id)
        .where(
            Activity.user_id == user_id,
            Activity.start_utc >= _utc(start - timedelta(days=1)),
            Activity.start_utc < _utc(end + timedelta(days=1)),
        )
    )
    if args.sport:
        query = query.where(Activity.sport == args.sport)
    if args.min_distance_km is not None:
        query = query.where(Activity.distance_m >= args.min_distance_km * 1000)
    if args.max_distance_km is not None:
        query = query.where(Activity.distance_m <= args.max_distance_km * 1000)
    rows = [(a, mt) for a, mt in db.execute(query).all() if start <= local_day(a.start_utc, a.timezone) < end]
    keys: dict[str, Callable[[tuple[Activity, ActivityMetrics | None]], float]] = {
        "date": lambda r: r[0].start_utc.timestamp(),
        "distance": lambda r: r[0].distance_m or 0,
        "duration": lambda r: r[0].moving_s or r[0].duration_s,
        "effort": lambda r: (r[1].trimp if r[1] else 0) or 0,
    }
    rows.sort(key=keys[args.sort], reverse=True)
    return {
        "period": {"from": start.isoformat(), "to": end.isoformat()},
        "totals": {
            "count": len(rows),
            "distance_m": round(sum(a.distance_m or 0 for a, _ in rows)),
            "moving_s": round(sum((a.moving_s or a.duration_s) for a, _ in rows)),
            "ascent_m": round(sum(a.ascent_m or 0 for a, _ in rows)),
        },
        "items": [
            {
                "activity_id": a.id,
                "link": f"/activities/{a.id}",
                "day": local_day(a.start_utc, a.timezone).isoformat(),
                "sport": a.sport,
                "sub_sport": a.sub_sport,
                "distance_m": round(a.distance_m) if a.distance_m else None,
                "moving_s": round(a.moving_s or a.duration_s),
                "ascent_m": round(a.ascent_m) if a.ascent_m else None,
                "avg_hr": a.avg_hr,
                "avg_speed_mps": _speed(a.distance_m, a.moving_s or a.duration_s),
                "relative_effort": round(mt.trimp, 1) if mt and mt.trimp else None,
            }
            for a, mt in rows[: args.limit]
        ],
        "truncated": len(rows) > args.limit,
    }


# --- activity_details ---------------------------------------------------------------------------------


class DetailsArgs(BaseModel):
    """Everything known about one activity: splits, laps, zones, best efforts and records."""

    activity_id: int


def activity_details(db: Session, user_id: int, args: DetailsArgs) -> dict[str, Any]:
    activity = db.get(Activity, args.activity_id)
    if activity is None or activity.user_id != user_id:
        raise ToolError(f"no activity {args.activity_id}")
    context = activity_context(db, activity, compare=True)
    context["link"] = f"/activities/{activity.id}"
    return context


# --- fitness_stats ------------------------------------------------------------------------------------


class FitnessArgs(BaseModel):
    """Fitness (CTL), fatigue (ATL) and form (TSB) over a period, plus weekly volume."""

    from_day: date | None = Field(None, alias="from", description="First day, inclusive (YYYY-MM-DD)")
    to_day: date | None = Field(None, alias="to", description="Last day, exclusive (YYYY-MM-DD)")

    model_config = {"populate_by_name": True}


def fitness_stats(db: Session, user_id: int, args: FitnessArgs) -> dict[str, Any]:
    start, end = _range(args.from_day, args.to_day, default_days=90)
    loads = list(
        db.scalars(
            select(DailyLoad)
            .where(DailyLoad.user_id == user_id, DailyLoad.day >= start, DailyLoad.day < end)
            .order_by(DailyLoad.day)
        )
    )
    if not loads:
        raise ToolError("no training load in that period")
    step = max(1, len(loads) // 30)  # about 30 points, whatever the period
    sampled = loads[::step]
    if sampled[-1] is not loads[-1]:
        sampled.append(loads[-1])
    rows = db.execute(
        select(Activity, ActivityMetrics)
        .outerjoin(ActivityMetrics, ActivityMetrics.activity_id == Activity.id)
        .where(
            Activity.user_id == user_id,
            Activity.start_utc >= _utc(start - timedelta(days=1)),
            Activity.start_utc < _utc(end + timedelta(days=1)),
        )
    ).all()
    weeks: dict[date, dict[str, float]] = {}
    for a, mt in rows:
        day = local_day(a.start_utc, a.timezone)
        if not start <= day < end:
            continue
        week = day - timedelta(days=day.weekday())
        totals = weeks.setdefault(
            week, {"count": 0, "distance_m": 0.0, "moving_s": 0.0, "relative_effort": 0.0}
        )
        totals["count"] += 1
        totals["distance_m"] += a.distance_m or 0
        totals["moving_s"] += a.moving_s or a.duration_s
        totals["relative_effort"] += (mt.trimp if mt else 0) or 0
    latest = loads[-1]
    return {
        "period": {"from": start.isoformat(), "to": end.isoformat()},
        "today": {
            "day": latest.day.isoformat(),
            "fitness": round(latest.ctl, 1),
            "fatigue": round(latest.atl, 1),
            "form": round(latest.tsb, 1),
        },
        "series": [
            {
                "day": row.day.isoformat(),
                "fitness": round(row.ctl, 1),
                "fatigue": round(row.atl, 1),
                "form": round(row.tsb, 1),
            }
            for row in sampled
        ],
        "weeks": [
            {
                "week_start": week.isoformat(),
                "count": int(t["count"]),
                "distance_m": round(t["distance_m"]),
                "moving_s": round(t["moving_s"]),
                "relative_effort": round(t["relative_effort"], 1),
            }
            for week, t in sorted(weeks.items())
        ],
    }


# --- records ------------------------------------------------------------------------------------------


class RecordsArgs(BaseModel):
    """Running records: all-time bests over standard distances and the bests of a period."""

    from_day: date | None = Field(None, alias="from", description="First day of the period (YYYY-MM-DD)")
    to_day: date | None = Field(None, alias="to", description="Last day of the period, exclusive")

    model_config = {"populate_by_name": True}


def records(db: Session, user_id: int, args: RecordsArgs) -> dict[str, Any]:
    start, end = _range(args.from_day, args.to_day, default_days=365, max_days=36500)
    rows = db.execute(
        select(BestEffort, Activity.start_utc, Activity.timezone)
        .join(Activity, Activity.id == BestEffort.activity_id)
        .where(BestEffort.user_id == user_id)
        .order_by(Activity.start_utc)
    ).all()
    all_time: dict[str, dict[str, Any]] = {}
    period: dict[str, dict[str, Any]] = {}
    for effort, started, timezone in rows:
        day = local_day(started, timezone)
        item = {
            "distance": effort.distance_key,
            "distance_m": round(effort.distance_m),
            "time_s": round(effort.time_s),
            "pace_s_per_km": round(effort.time_s / effort.distance_m * 1000, 1),
            "day": day.isoformat(),
            "activity_id": effort.activity_id,
            "link": f"/activities/{effort.activity_id}",
        }
        key = effort.distance_key
        if key not in all_time or effort.time_s < all_time[key]["time_s"]:
            all_time[key] = item
        if start <= day < end and (key not in period or effort.time_s < period[key]["time_s"]):
            period[key] = item
    if not all_time:
        raise ToolError("no best efforts yet")
    return {
        "period": {"from": start.isoformat(), "to": end.isoformat()},
        "all_time": sorted(all_time.values(), key=lambda r: r["distance_m"]),
        "period_bests": sorted(period.values(), key=lambda r: r["distance_m"]),
    }


# --- daily_health -------------------------------------------------------------------------------------


class HealthArgs(BaseModel):
    """Sleep, HRV, resting heart rate, readiness and form per day (at most 90 days)."""

    from_day: date | None = Field(None, alias="from", description="First day, inclusive (YYYY-MM-DD)")
    to_day: date | None = Field(None, alias="to", description="Last day, exclusive (YYYY-MM-DD)")

    model_config = {"populate_by_name": True}


def daily_health(db: Session, user_id: int, args: HealthArgs) -> dict[str, Any]:
    from zankup.health import resolve

    start, end = _range(args.from_day, args.to_day, default_days=14, max_days=HEALTH_MAX_DAYS)
    days = resolve.days(db, user_id, start, end - timedelta(days=1))
    items = []
    for d in days:
        sleep = d.sleep
        item = {
            "day": d.day.isoformat(),
            "asleep_s": sleep.asleep_s if sleep else None,
            "sleep_score": sleep.score if sleep else None,
            "deep_s": sleep.deep_s if sleep else None,
            "rem_s": sleep.rem_s if sleep else None,
            "hrv_ms": round(d.values["hrv"].value, 1) if "hrv" in d.values else None,
            "resting_hr": round(d.values["resting_hr"].value) if "resting_hr" in d.values else None,
            "steps": round(d.values["steps"].value) if "steps" in d.values else None,
            "form": round(d.tsb, 1) if d.tsb is not None else None,
            "readiness": d.readiness.score if d.readiness else None,
        }
        if any(v is not None for k, v in item.items() if k != "day"):
            items.append(item)
    if not items:
        raise ToolError("no health data in that period")
    return {"period": {"from": start.isoformat(), "to": end.isoformat()}, "days": items}


# --- estimates ----------------------------------------------------------------------------------------


class EstimatesArgs(BaseModel):
    """Current performance estimates: FTP, critical speed, VDOT, threshold HR, race predictions."""


def estimates(db: Session, user_id: int, args: EstimatesArgs) -> dict[str, Any]:
    rows = list(
        db.scalars(select(EstimateRow).where(EstimateRow.user_id == user_id).order_by(EstimateRow.day))
    )
    if not rows:
        raise ToolError("no estimates yet")
    latest: dict[str, EstimateRow] = {}
    for row in rows:
        latest[row.kind] = row
    return {
        "estimates": [
            {"kind": kind, "value": round(row.value, 1), "method": row.method, "day": row.day.isoformat()}
            for kind, row in sorted(latest.items())
        ]
    }


# --- registry -----------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Tool:
    name: str
    args: type[BaseModel]
    run: Callable[[Session, int, Any], dict[str, Any]]

    @property
    def description(self) -> str:
        return (self.args.__doc__ or "").strip()

    def schema(self) -> dict[str, Any]:
        schema = self.args.model_json_schema(by_alias=True)
        schema.pop("title", None)
        schema.pop("description", None)
        for prop in schema.get("properties", {}).values():
            prop.pop("title", None)
        schema["additionalProperties"] = False
        return schema

    def spec(self) -> dict[str, Any]:
        """The tool as the Messages API wants it."""
        return {"name": self.name, "description": self.description, "input_schema": self.schema()}


TOOLS: tuple[Tool, ...] = (
    Tool("search_activities", SearchArgs, search_activities),
    Tool("activity_details", DetailsArgs, activity_details),
    Tool("fitness_stats", FitnessArgs, fitness_stats),
    Tool("records", RecordsArgs, records),
    Tool("daily_health", HealthArgs, daily_health),
    Tool("estimates", EstimatesArgs, estimates),
)
BY_NAME = {tool.name: tool for tool in TOOLS}


def tool_specs() -> list[dict[str, Any]]:
    return [tool.spec() for tool in TOOLS]


def run_tool(db: Session, user_id: int, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Validate the arguments, run the tool and check nothing forbidden is in the answer."""
    tool = BY_NAME.get(name)
    if tool is None:
        raise ToolError(f"unknown tool {name}")
    try:
        args = tool.args.model_validate(arguments or {})
    except ValidationError as error:
        raise ToolError(
            "; ".join(f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in error.errors())
        ) from error
    result = tool.run(db, user_id, args)
    assert_minimised(result)
    return result
