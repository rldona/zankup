"""Personal segments (OS-325): a stretch saved from an activity, found in every activity that goes
through it. Candidates are those whose bounding box holds the segment's start and end; the exact
start and end come from their series."""

from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

import zankup_metrics as m
from zankup.db.models import Activity, Segment, SegmentEffort
from zankup.engine.activity import series_of
from zankup.fit.streams import decode_polyline

MARGIN = 0.001  # degrees, about 100 m


def _inside(bbox: list[float] | None, point: tuple[float, float]) -> bool:
    if not bbox:
        return False
    return (
        bbox[0] - MARGIN <= point[0] <= bbox[2] + MARGIN and bbox[1] - MARGIN <= point[1] <= bbox[3] + MARGIN
    )


def effort_in(db: Session, segment: Segment, activity: Activity) -> SegmentEffort | None:
    """Find the segment in one activity and store (or clear) its effort."""
    track = decode_polyline(segment.track, 6)
    db.execute(
        delete(SegmentEffort).where(
            SegmentEffort.segment_id == segment.id, SegmentEffort.activity_id == activity.id
        )
    )
    if not (_inside(activity.bbox, track[0]) and _inside(activity.bbox, track[-1])):
        return None
    series = series_of(db, activity.id)
    if not series or not series.get("lat") or not series.get("lon"):
        return None
    points = [
        (lat, lon) if lat is not None and lon is not None else None
        for lat, lon in zip(series["lat"], series["lon"], strict=True)
    ]
    match = m.find_segment(track, points)
    if match is None:
        return None
    t = series["t"]

    def mean(name: str) -> int | None:
        values = [v for v in (series.get(name) or [])[match.start : match.end + 1] if v is not None]
        return round(sum(values) / len(values)) if values else None

    db.execute(
        insert(SegmentEffort).values(
            segment_id=segment.id,
            activity_id=activity.id,
            user_id=activity.user_id,
            start_s=t[match.start],
            elapsed_s=t[match.end] - t[match.start],
            avg_hr=mean("hr"),
            avg_power=mean("power"),
        )
    )
    return db.scalar(
        select(SegmentEffort).where(
            SegmentEffort.segment_id == segment.id, SegmentEffort.activity_id == activity.id
        )
    )


def search_segment(db: Session, segment: Segment) -> int:
    """Look for a segment in every activity with a track. Returns how many efforts were found."""
    found = 0
    for activity in db.scalars(
        select(Activity).where(Activity.user_id == segment.user_id, Activity.has_gps.is_(True))
    ):
        if effort_in(db, segment, activity):
            found += 1
    return found


def search_activity(db: Session, activity: Activity) -> int:
    """Look for every segment of the user in one activity."""
    found = 0
    if not activity.has_gps:
        return 0
    for segment in db.scalars(select(Segment).where(Segment.user_id == activity.user_id)):
        if effort_in(db, segment, activity):
            found += 1
    return found
