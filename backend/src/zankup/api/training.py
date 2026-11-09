"""Matched routes (OS-309), personal segments (OS-325), goals (OS-318), the engine's events (OS-319)
and its recomputation progress (OS-314)."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from typing import Literal

from fastapi import HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from zankup.api.routing import protected_router
from zankup.api.stats import _bucket, _next
from zankup.auth.deps import CurrentUser, DbSession
from zankup.db.models import Activity, ActivityMetrics, Event, Goal, Segment, SegmentEffort
from zankup.engine import METRICS_VERSION
from zankup.engine.activity import series_of
from zankup.engine.run import counts, progress, queue_full, queue_segment
from zankup.engine.user import local_day
from zankup.fit.streams import encode_polyline

router = protected_router(prefix="/api", tags=["training"])

# --- matched routes ---------------------------------------------------------------------------------


class RouteActivity(BaseModel):
    id: int
    name: str | None
    day: date
    moving_s: float
    distance_m: float | None
    avg_hr: int | None


class RouteGroup(BaseModel):
    id: int = Field(description="The group's first activity")
    sport: str
    name: str | None
    route: str | None = Field(description="Encoded polyline of the first activity")
    count: int
    best: RouteActivity
    latest: RouteActivity


def _route_activity(a: Activity) -> RouteActivity:
    return RouteActivity(
        id=a.id,
        name=a.name,
        day=local_day(a.start_utc, a.timezone),
        moving_s=a.moving_s or a.duration_s,
        distance_m=a.distance_m,
        avg_hr=a.avg_hr,
    )


def _groups(db: DbSession, user_id: int, only: int | None = None) -> dict[int, list[Activity]]:
    query = (
        select(Activity, ActivityMetrics.route_group)
        .join(ActivityMetrics, ActivityMetrics.activity_id == Activity.id)
        .where(Activity.user_id == user_id, ActivityMetrics.route_group.is_not(None))
        .order_by(Activity.start_utc)
    )
    if only is not None:
        query = query.where(ActivityMetrics.route_group == only)
    groups: dict[int, list[Activity]] = defaultdict(list)
    for activity, group in db.execute(query).all():
        if group is not None:
            groups[group].append(activity)
    return groups


def _group_out(group: int, members: list[Activity]) -> RouteGroup:
    first = next((a for a in members if a.id == group), members[0])
    best = min(members, key=lambda a: a.moving_s or a.duration_s)
    return RouteGroup(
        id=group,
        sport=first.sport,
        name=first.name,
        route=first.route_simplified,
        count=len(members),
        best=_route_activity(best),
        latest=_route_activity(members[-1]),
    )


@router.get("/routes", operation_id="listRoutes")
def list_routes(db: DbSession, user: CurrentUser) -> list[RouteGroup]:
    """Routes done more than once, most repeated first."""
    groups = [_group_out(g, members) for g, members in _groups(db, user.id).items() if len(members) > 1]
    return sorted(groups, key=lambda g: (-g.count, g.latest.day), reverse=False)


class RouteDetail(RouteGroup):
    activities: list[RouteActivity] = Field(description="Every time, oldest first")


@router.get("/routes/{group_id}", operation_id="getRoute")
def get_route(group_id: int, db: DbSession, user: CurrentUser) -> RouteDetail:
    members = _groups(db, user.id, group_id).get(group_id)
    if not members:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Route not found")
    return RouteDetail(
        **_group_out(group_id, members).model_dump(), activities=[_route_activity(a) for a in members]
    )


# --- segments ---------------------------------------------------------------------------------------


class SegmentCreate(BaseModel):
    activity_id: int
    start_index: int = Field(ge=0, description="Sample index in the activity's series where it starts")
    end_index: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=120)


class SegmentEffortOut(BaseModel):
    activity_id: int
    activity_name: str | None
    day: date
    elapsed_s: float
    avg_hr: int | None
    avg_power: int | None


class SegmentOut(BaseModel):
    id: int
    name: str
    track: str = Field(description="Encoded polyline (precision 6)")
    distance_m: float
    ascent_m: float | None
    efforts: int
    best_s: float | None


class SegmentDetail(SegmentOut):
    history: list[SegmentEffortOut] = Field(description="Every effort, oldest first")


def _segment_out(db: DbSession, segment: Segment) -> SegmentOut:
    count, best = db.execute(
        select(func.count(), func.min(SegmentEffort.elapsed_s)).where(SegmentEffort.segment_id == segment.id)
    ).one()
    return SegmentOut(
        id=segment.id,
        name=segment.name,
        track=segment.track,
        distance_m=segment.distance_m,
        ascent_m=segment.ascent_m,
        efforts=count,
        best_s=best,
    )


@router.post("/segments", status_code=status.HTTP_201_CREATED, operation_id="createSegment")
def create_segment(body: SegmentCreate, db: DbSession, user: CurrentUser) -> SegmentOut:
    """Save a stretch of an activity as a segment; the engine then finds it in every other one."""
    activity = db.scalar(select(Activity).where(Activity.id == body.activity_id, Activity.user_id == user.id))
    if activity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activity not found")
    series = series_of(db, activity.id) or {}
    lat, lon = series.get("lat") or [], series.get("lon") or []
    a, b = body.start_index, min(body.end_index, len(lat) - 1)
    points = [
        (la, lo)
        for la, lo in zip(lat[a : b + 1], lon[a : b + 1], strict=True)
        if la is not None and lo is not None
    ]
    if b <= a or len(points) < 5:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Pick a longer stretch with GPS")
    dist = series.get("dist") or []
    alt = [v for v in (series.get("alt") or [])[a : b + 1] if v is not None]
    distance = (dist[b] or 0) - (dist[a] or 0) if len(dist) > b and dist[a] is not None else 0.0
    ascent = sum(max(0.0, alt[i] - alt[i - 1]) for i in range(1, len(alt))) if alt else None
    segment = Segment(
        user_id=user.id,
        name=body.name.strip(),
        track=encode_polyline([*points[:: max(1, len(points) // 400)], points[-1]], 6),
        distance_m=round(distance, 1),
        ascent_m=round(ascent, 1) if ascent is not None else None,
        source_activity_id=activity.id,
    )
    db.add(segment)
    db.flush()
    queue_segment(db, user.id, segment.id)
    db.commit()
    return _segment_out(db, segment)


@router.get("/segments", operation_id="listSegments")
def list_segments(db: DbSession, user: CurrentUser) -> list[SegmentOut]:
    return [
        _segment_out(db, s)
        for s in db.scalars(select(Segment).where(Segment.user_id == user.id).order_by(Segment.name))
    ]


@router.get("/segments/{segment_id}", operation_id="getSegment")
def get_segment(segment_id: int, db: DbSession, user: CurrentUser) -> SegmentDetail:
    segment = db.scalar(select(Segment).where(Segment.id == segment_id, Segment.user_id == user.id))
    if segment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Segment not found")
    rows = db.execute(
        select(SegmentEffort, Activity)
        .join(Activity, Activity.id == SegmentEffort.activity_id)
        .where(SegmentEffort.segment_id == segment.id)
        .order_by(Activity.start_utc)
    ).all()
    history = [
        SegmentEffortOut(
            activity_id=a.id,
            activity_name=a.name,
            day=local_day(a.start_utc, a.timezone),
            elapsed_s=e.elapsed_s,
            avg_hr=e.avg_hr,
            avg_power=e.avg_power,
        )
        for e, a in rows
    ]
    return SegmentDetail(**_segment_out(db, segment).model_dump(), history=history)


@router.delete("/segments/{segment_id}", status_code=status.HTTP_204_NO_CONTENT, operation_id="deleteSegment")
def delete_segment(segment_id: int, db: DbSession, user: CurrentUser) -> None:
    segment = db.scalar(select(Segment).where(Segment.id == segment_id, Segment.user_id == user.id))
    if segment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Segment not found")
    db.delete(segment)
    db.commit()


# --- goals ------------------------------------------------------------------------------------------


class GoalCreate(BaseModel):
    period: Literal["week", "month", "year"]
    metric: Literal["distance", "time", "count"]
    sport: str | None = None
    target: float = Field(gt=0, description="Metres, seconds or a number of activities")


class GoalOut(BaseModel):
    id: int
    period: str
    metric: str
    sport: str | None
    target: float
    start: date
    end: date
    current: float
    projection: float = Field(description="Where the current pace ends the period")


def _goal_out(db: DbSession, goal: Goal, today: date) -> GoalOut:
    start = _bucket(today, goal.period)
    end = _next(start, goal.period)
    query = select(Activity).where(
        Activity.user_id == goal.user_id,
        Activity.start_utc >= datetime.combine(start - timedelta(days=1), datetime.min.time(), UTC),
        Activity.start_utc < datetime.combine(end + timedelta(days=1), datetime.min.time(), UTC),
    )
    if goal.sport:
        query = query.where(Activity.sport == goal.sport)
    current = 0.0
    for a in db.scalars(query):
        if not start <= local_day(a.start_utc, a.timezone) < end:
            continue
        current += {"distance": a.distance_m or 0, "time": a.moving_s or a.duration_s, "count": 1}[
            goal.metric
        ]
    elapsed = (today - start).days + 1
    length = (end - start).days
    return GoalOut(
        id=goal.id,
        period=goal.period,
        metric=goal.metric,
        sport=goal.sport,
        target=goal.target,
        start=start,
        end=end,
        current=current,
        projection=current * length / elapsed,
    )


@router.get("/goals", operation_id="listGoals")
def list_goals(db: DbSession, user: CurrentUser) -> list[GoalOut]:
    """Goals with where they stand this period and the end-of-period projection (OS-318)."""
    today = datetime.now(UTC).date()
    return [
        _goal_out(db, g, today)
        for g in db.scalars(select(Goal).where(Goal.user_id == user.id).order_by(Goal.id))
    ]


@router.post("/goals", status_code=status.HTTP_201_CREATED, operation_id="createGoal")
def create_goal(body: GoalCreate, db: DbSession, user: CurrentUser) -> GoalOut:
    goal = Goal(user_id=user.id, **body.model_dump())
    db.add(goal)
    db.commit()
    return _goal_out(db, goal, datetime.now(UTC).date())


@router.delete("/goals/{goal_id}", status_code=status.HTTP_204_NO_CONTENT, operation_id="deleteGoal")
def delete_goal(goal_id: int, db: DbSession, user: CurrentUser) -> None:
    goal = db.scalar(select(Goal).where(Goal.id == goal_id, Goal.user_id == user.id))
    if goal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Goal not found")
    db.delete(goal)
    db.commit()


# --- events and the engine --------------------------------------------------------------------------


class EventOut(BaseModel):
    id: int
    kind: str
    payload: dict[str, object]
    created_at: datetime


@router.get("/events", operation_id="listEvents")
def list_events(db: DbSession, user: CurrentUser, limit: int = 20) -> list[EventOut]:
    """What the engine noticed, newest first: records, estimates going up, risky ramps (OS-319)."""
    rows = db.scalars(
        select(Event).where(Event.user_id == user.id).order_by(Event.created_at.desc()).limit(min(limit, 100))
    )
    return [EventOut(id=e.id, kind=e.kind, payload=e.payload, created_at=e.created_at) for e in rows]


class EngineStatus(BaseModel):
    running: bool
    reason: str | None
    done: int
    total: int
    computed: int = Field(description="Activities computed with the current metrics version")
    activities: int
    metrics_version: int


@router.get("/engine", operation_id="getEngine")
def engine_status(db: DbSession, user: CurrentUser) -> EngineStatus:
    """Whether a full recomputation is going on, and how far it is (OS-314)."""
    run = progress(db, user.id)
    total, computed = counts(db, user.id)
    running = run is not None and run.status == "running"
    return EngineStatus(
        running=running,
        reason=run.reason if run else None,
        done=run.done if run else 0,
        total=run.total if run else 0,
        computed=computed,
        activities=total,
        metrics_version=METRICS_VERSION,
    )


@router.post("/engine/recompute", status_code=status.HTTP_202_ACCEPTED, operation_id="recompute")
def recompute(db: DbSession, user: CurrentUser) -> EngineStatus:
    """Recompute every metric from the stored series, in the background."""
    queue_full(db, user.id, "asked from Settings")
    db.commit()
    return engine_status(db, user)
