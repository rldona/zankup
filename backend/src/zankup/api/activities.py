"""Activities: the feed, the detail, the series and the original file (OS-111).

Every query filters by the signed-in user: an activity of someone else answers 404, the same as one
that does not exist. The feed is paginated with an opaque cursor (newest first, by start time and ID),
so pages stay stable while new activities arrive.
"""

from __future__ import annotations

import base64
import binascii
import gzip
import hashlib
import logging
from datetime import datetime
from typing import Annotated, Any

from fastapi import Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import Interval, case, cast, exists, func, literal, select, tuple_
from sqlalchemy.orm import defer

from zankup.api.routing import protected_router
from zankup.auth.deps import AppSettings, CurrentUser, DbSession
from zankup.db.models import Activity, BestEffort, Lap, Stream
from zankup.storage import RawStore, StorageError, get_raw_store

log = logging.getLogger("zankup.api.activities")

router = protected_router(prefix="/api/activities", tags=["activities"])

DEFAULT_PAGE = 30
MAX_PAGE = 100
FIT_MEDIA_TYPE = "application/vnd.ant.fit"


def get_store(settings: AppSettings) -> RawStore:
    return get_raw_store(settings)


Store = Annotated[RawStore, Depends(get_store)]


# --- response models -------------------------------------------------------------------------------


class ActivitySummary(BaseModel):
    """What a feed card needs."""

    id: int
    name: str | None
    sport: str = Field(description="run, ride, strength, walk, row, swim or other")
    sub_sport: str | None
    source: str
    start_utc: datetime
    timezone: str | None = Field(description='UTC offset when recorded, e.g. "+01:00"')
    duration_s: float
    moving_s: float | None
    distance_m: float | None
    ascent_m: float | None
    avg_hr: int | None
    avg_power: int | None
    has_gps: bool
    route: str | None = Field(description="Simplified route as an encoded polyline (precision 5)")


class ActivityPage(BaseModel):
    items: list[ActivitySummary]
    next_cursor: str | None = Field(description="Pass it as `cursor` for the next page; null at the end")


class SearchTotals(BaseModel):
    count: int
    distance_m: float
    moving_s: float
    ascent_m: float


class SearchPage(BaseModel):
    items: list[ActivitySummary]
    totals: SearchTotals = Field(description="Of every activity that matches, not just this page")
    next_offset: int | None = Field(description="Pass it as `offset` for the next page; null at the end")


SORTS = {"date", "distance", "duration", "elevation", "speed"}


class MonthTotals(BaseModel):
    """One month of the feed, in the activities' own local time."""

    month: str = Field(description='"YYYY-MM"')
    count: int
    distance_m: float
    moving_s: float = Field(description="Moving time, or the elapsed time when there is none")
    ascent_m: float


class LapOut(BaseModel):
    idx: int
    start_utc: datetime
    duration_s: float
    distance_m: float | None
    avg_hr: int | None
    max_hr: int | None
    avg_power: int | None
    ascent_m: float | None
    descent_m: float | None


class SplitOut(BaseModel):
    distance_m: float
    time_s: float
    elevation_change_m: float | None
    avg_hr: int | None


class BestEffortOut(BaseModel):
    distance_key: str = Field(description="e.g. 1k, 5k, half_marathon")
    distance_m: float
    time_s: float
    start_s: float = Field(description="Seconds from the start of the activity")
    start_distance_m: float


class StreamsInfo(BaseModel):
    series: list[str] = Field(description="Series present, always including t")
    sample_count: int


class ActivityDetail(ActivitySummary):
    description: str | None
    descent_m: float | None
    max_hr: int | None
    normalized_power: int | None
    calories: int | None
    training_effect: float | None
    device: str | None
    bbox: list[float] | None = Field(description="[min_lat, min_lon, max_lat, max_lon]")
    has_fit: bool
    imported_at: datetime
    laps: list[LapOut]
    splits: list[SplitOut]
    best_efforts: list[BestEffortOut]
    streams: StreamsInfo | None


class ActivityStreams(BaseModel):
    """One array per series, all the same length; missing samples are null. Units are SI."""

    t: list[float] = Field(description="Seconds from the start")
    lat: list[float | None] | None = None
    lon: list[float | None] | None = None
    dist: list[float | None] | None = Field(None, description="Metres")
    alt: list[float | None] | None = Field(None, description="Metres")
    hr: list[int | None] | None = Field(None, description="Beats per minute")
    cad: list[float | None] | None = Field(None, description="Steps or revolutions per minute")
    speed: list[float | None] | None = Field(None, description="m/s")
    power: list[int | None] | None = Field(None, description="Watts")
    temp: list[float | None] | None = Field(None, description="°C")


# --- cursor ----------------------------------------------------------------------------------------


def encode_cursor(activity: Activity) -> str:
    raw = f"{activity.start_utc.isoformat()}|{activity.id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, int]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        start, activity_id = raw.split("|")
        return datetime.fromisoformat(start), int(activity_id)
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid cursor") from None


# --- helpers ---------------------------------------------------------------------------------------


def _summary_fields(activity: Activity) -> dict[str, Any]:
    return {
        "id": activity.id,
        "name": activity.name,
        "sport": activity.sport,
        "sub_sport": activity.sub_sport,
        "source": activity.source,
        "start_utc": activity.start_utc,
        "timezone": activity.timezone,
        "duration_s": activity.duration_s,
        "moving_s": activity.moving_s,
        "distance_m": activity.distance_m,
        "ascent_m": activity.ascent_m,
        "avg_hr": activity.avg_hr,
        "avg_power": activity.avg_power,
        "has_gps": activity.has_gps,
        "route": activity.route_simplified,
    }


def _own_activity(db: DbSession, user: CurrentUser, activity_id: int) -> Activity:
    activity = db.scalar(select(Activity).where(Activity.id == activity_id, Activity.user_id == user.id))
    if activity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activity not found")
    return activity


def _not_modified(request: Request, etag: str) -> bool:
    return etag in {tag.strip() for tag in request.headers.get("If-None-Match", "").split(",")}


# --- routes ----------------------------------------------------------------------------------------


@router.get("", operation_id="listActivities")
def list_activities(
    db: DbSession,
    user: CurrentUser,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE)] = DEFAULT_PAGE,
    sport: Annotated[list[str] | None, Query(description="Only these sports (repeat to combine)")] = None,
) -> ActivityPage:
    """The feed: newest first."""
    query = (
        select(Activity)
        .where(Activity.user_id == user.id)
        .options(defer(Activity.raw_meta), defer(Activity.splits), defer(Activity.description))
        .order_by(Activity.start_utc.desc(), Activity.id.desc())
        .limit(limit + 1)
    )
    if sport:
        query = query.where(Activity.sport.in_(sport))
    if cursor:
        query = query.where(tuple_(Activity.start_utc, Activity.id) < decode_cursor(cursor))
    rows = list(db.scalars(query))
    page, more = rows[:limit], len(rows) > limit
    return ActivityPage(
        items=[ActivitySummary(**_summary_fields(a)) for a in page],
        next_cursor=encode_cursor(page[-1]) if more else None,
    )


@router.get("/search", operation_id="searchActivities")
def search_activities(
    db: DbSession,
    user: CurrentUser,
    q: Annotated[str | None, Query(max_length=200, description="Words in the name or description")] = None,
    sport: Annotated[list[str] | None, Query(description="Only these sports (repeat to combine)")] = None,
    start: Annotated[datetime | None, Query(alias="from", description="From this moment (inclusive)")] = None,
    end: Annotated[datetime | None, Query(alias="to", description="Until this moment (exclusive)")] = None,
    min_distance: Annotated[float | None, Query(ge=0, description="Metres")] = None,
    max_distance: Annotated[float | None, Query(ge=0)] = None,
    min_duration: Annotated[float | None, Query(ge=0, description="Moving seconds")] = None,
    max_duration: Annotated[float | None, Query(ge=0)] = None,
    min_ascent: Annotated[float | None, Query(ge=0, description="Metres")] = None,
    min_hr: Annotated[int | None, Query(ge=0)] = None,
    max_hr: Annotated[int | None, Query(ge=0)] = None,
    with_record: bool = False,
    with_description: bool = False,
    with_gps: bool = False,
    source: Annotated[list[str] | None, Query(description="garmin, strava…")] = None,
    sort: Annotated[str, Query(description="date, distance, duration, elevation or speed")] = "date",
    order: Annotated[str, Query(pattern="^(asc|desc)$")] = "desc",
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE)] = 50,
) -> SearchPage:
    """Advanced search (OS-219): any combination of filters, sorted, with totals of all the matches."""
    if sort not in SORTS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"sort must be one of {sorted(SORTS)}")
    moving = func.coalesce(Activity.moving_s, Activity.duration_s)
    conditions = [Activity.user_id == user.id]
    if q and q.strip():
        words = " & ".join(
            f"{w}:*" for w in "".join(c if c.isalnum() else " " for c in q.lower()).split()
        )  # every word, as a prefix
        if words:
            conditions.append(
                func.zankup_search_text(Activity.name, Activity.description).op("@@")(
                    func.to_tsquery("simple", func.unaccent(words))
                )
            )
    if sport:
        conditions.append(Activity.sport.in_(sport))
    if source:
        conditions.append(Activity.source.in_(source))
    if start:
        conditions.append(Activity.start_utc >= start)
    if end:
        conditions.append(Activity.start_utc < end)
    if min_distance is not None:
        conditions.append(Activity.distance_m >= min_distance)
    if max_distance is not None:
        conditions.append(Activity.distance_m <= max_distance)
    if min_duration is not None:
        conditions.append(moving >= min_duration)
    if max_duration is not None:
        conditions.append(moving <= max_duration)
    if min_ascent is not None:
        conditions.append(Activity.ascent_m >= min_ascent)
    if min_hr is not None:
        conditions.append(Activity.avg_hr >= min_hr)
    if max_hr is not None:
        conditions.append(Activity.avg_hr <= max_hr)
    if with_description:
        conditions.append(func.length(func.trim(func.coalesce(Activity.description, ""))) > 0)
    if with_gps:
        conditions.append(Activity.has_gps.is_(True))
    if with_record:
        best = (
            select(BestEffort.distance_key, func.min(BestEffort.time_s).label("time_s"))
            .where(BestEffort.user_id == user.id)
            .group_by(BestEffort.distance_key)
            .subquery()
        )
        conditions.append(
            exists().where(
                BestEffort.activity_id == Activity.id,
                BestEffort.distance_key == best.c.distance_key,
                BestEffort.time_s == best.c.time_s,
            )
        )

    totals = db.execute(
        select(
            func.count(),
            func.coalesce(func.sum(Activity.distance_m), 0),
            func.coalesce(func.sum(moving), 0),
            func.coalesce(func.sum(Activity.ascent_m), 0),
        ).where(*conditions)
    ).one()
    key = {
        "date": Activity.start_utc,
        "distance": Activity.distance_m,
        "duration": moving,
        "elevation": Activity.ascent_m,
        "speed": Activity.distance_m / func.nullif(moving, 0),
    }[sort]
    ordered = key.desc().nulls_last() if order == "desc" else key.asc().nulls_last()
    rows = list(
        db.scalars(
            select(Activity)
            .where(*conditions)
            .options(defer(Activity.raw_meta), defer(Activity.splits))
            .order_by(ordered, Activity.id.desc())
            .offset(offset)
            .limit(limit + 1)
        )
    )
    more = len(rows) > limit
    return SearchPage(
        items=[ActivitySummary(**_summary_fields(a)) for a in rows[:limit]],
        totals=SearchTotals(count=totals[0], distance_m=totals[1], moving_s=totals[2], ascent_m=totals[3]),
        next_offset=offset + limit if more else None,
    )


@router.get("/months", operation_id="listActivityMonths")
def list_months(
    db: DbSession,
    user: CurrentUser,
    sport: Annotated[list[str] | None, Query(description="Only these sports (repeat to combine)")] = None,
) -> list[MonthTotals]:
    """Totals per month, newest first: the headers of the feed, whole even while it loads by pages."""
    offset = case(
        (Activity.timezone.regexp_match(r"^[+-]\d{2}:\d{2}$"), cast(Activity.timezone, Interval)),
        else_=cast(literal("0"), Interval),
    )
    month = func.to_char(func.timezone("UTC", Activity.start_utc) + offset, "YYYY-MM").label("month")
    query = (
        select(
            month,
            func.count(),
            func.coalesce(func.sum(Activity.distance_m), 0),
            func.sum(func.coalesce(Activity.moving_s, Activity.duration_s)),
            func.coalesce(func.sum(Activity.ascent_m), 0),
        )
        .where(Activity.user_id == user.id)
        .group_by(month)
        .order_by(month.desc())
    )
    if sport:
        query = query.where(Activity.sport.in_(sport))
    return [
        MonthTotals(month=m, count=n, distance_m=d, moving_s=t, ascent_m=a)
        for m, n, d, t, a in db.execute(query)
    ]


@router.get("/{activity_id}", operation_id="getActivity")
def get_activity(activity_id: int, db: DbSession, user: CurrentUser) -> ActivityDetail:
    """Summary, laps, per-km splits and best efforts. The series themselves are in `/streams`."""
    activity = _own_activity(db, user, activity_id)
    laps = db.scalars(select(Lap).where(Lap.activity_id == activity.id).order_by(Lap.idx))
    efforts = db.scalars(
        select(BestEffort).where(BestEffort.activity_id == activity.id).order_by(BestEffort.distance_m)
    )
    stream = db.execute(
        select(Stream.series, Stream.sample_count).where(Stream.activity_id == activity.id)
    ).one_or_none()
    return ActivityDetail(
        **_summary_fields(activity),
        description=activity.description,
        descent_m=activity.descent_m,
        max_hr=activity.max_hr,
        normalized_power=activity.normalized_power,
        calories=activity.calories,
        training_effect=activity.training_effect,
        device=activity.device,
        bbox=activity.bbox,
        has_fit=activity.fit_path is not None,
        imported_at=activity.imported_at,
        laps=[LapOut.model_validate(lap, from_attributes=True) for lap in laps],
        splits=[SplitOut.model_validate(split) for split in activity.splits or []],
        best_efforts=[BestEffortOut.model_validate(e, from_attributes=True) for e in efforts],
        streams=StreamsInfo(series=stream.series, sample_count=stream.sample_count) if stream else None,
    )


@router.get(
    "/{activity_id}/streams",
    operation_id="getActivityStreams",
    response_class=Response,
    responses={
        200: {"model": ActivityStreams, "description": "Gzip-encoded JSON"},
        304: {"description": "Not modified (If-None-Match)"},
        404: {"description": "No such activity, or it has no series"},
    },
)
def get_activity_streams(activity_id: int, request: Request, db: DbSession, user: CurrentUser) -> Response:
    """All the series of an activity. Sent as stored, gzip-compressed, to clients that accept it."""
    activity = _own_activity(db, user, activity_id)
    data = db.scalar(select(Stream.data).where(Stream.activity_id == activity.id))
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This activity has no series")
    etag = f'"{hashlib.sha256(data).hexdigest()[:32]}"'
    headers = {"ETag": etag, "Cache-Control": "private, no-cache", "Vary": "Accept-Encoding"}
    if _not_modified(request, etag):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    if "gzip" in request.headers.get("Accept-Encoding", "").lower():
        return Response(data, media_type="application/json", headers={**headers, "Content-Encoding": "gzip"})
    return Response(gzip.decompress(data), media_type="application/json", headers=headers)


@router.get(
    "/{activity_id}/fit",
    operation_id="getActivityFit",
    response_class=Response,
    responses={
        200: {"content": {FIT_MEDIA_TYPE: {"schema": {"type": "string", "format": "binary"}}}},
        304: {"description": "Not modified (If-None-Match)"},
        404: {"description": "No such activity, or it was not imported from a FIT file"},
    },
)
def get_activity_fit(
    activity_id: int, request: Request, db: DbSession, user: CurrentUser, store: Store
) -> Response:
    """The original FIT file, exactly as received from the source."""
    activity = _own_activity(db, user, activity_id)
    if activity.fit_path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This activity has no original file")
    etag = f'"{activity.fit_sha256}"'
    headers = {
        "ETag": etag,
        "Cache-Control": "private, max-age=31536000, immutable",  # originals never change
        "Content-Disposition": f'attachment; filename="zankup-{activity.id}.fit"',
    }
    if _not_modified(request, etag):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    try:
        data = store.get(activity.fit_path, activity.fit_sha256)
    except StorageError:
        log.exception("Original file unavailable", extra={"activity_id": activity.id})
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, "The original file is unavailable"
        ) from None
    return Response(data, media_type=FIT_MEDIA_TYPE, headers=headers)
