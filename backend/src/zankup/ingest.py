"""Ingestion: original file → raw store → parsed activity, laps and streams in Postgres (OS-106).

Idempotent by (user, source, external ID): importing the same activity again changes nothing. The
original is stored first (immutable, see storage.py), so a failure later leaves it in place and the
import can simply be retried. `reprocess=True` re-reads the stored original and rewrites the derived
rows, which is how a parser improvement reaches activities that are already imported.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

import zankup_metrics as metrics
from zankup.db.models import Activity, BestEffort, Gear, Lap, Stream
from zankup.fit.files import parse_file
from zankup.fit.parser import ParsedActivity
from zankup.fit.streams import ENCODING, encode_streams, route_polyline
from zankup.storage import RawStore, raw_key

log = logging.getLogger("zankup.ingest")

SAME_START = timedelta(minutes=2)  # two recordings starting this close are the same activity
ADOPTABLE = ("strava", "file")  # a Garmin FIT replaces the file of an activity imported from these
BEST_EFFORT_SPORTS = {"run"}  # running distances (400 m … marathon); cycling gets power curves in OS-306
SPORT_NAMES = {
    "run": "Run",
    "ride": "Ride",
    "strength": "Strength",
    "walk": "Walk",
    "row": "Row",
    "swim": "Swim",
}


@dataclass(frozen=True)
class IngestResult:
    activity_id: int
    created: bool
    reprocessed: bool = False
    merged: bool = False  # the file replaced that of an activity imported from Strava or a file


def _name(parsed: ParsedActivity, meta: dict[str, Any] | None) -> str:
    name = (meta or {}).get("activityName")
    return str(name) if name else SPORT_NAMES.get(parsed.sport, "Activity")


def _apply(activity: Activity, parsed: ParsedActivity) -> None:
    if "sport" not in (activity.edited_fields or []):
        activity.sport = parsed.sport
        activity.sub_sport = parsed.sub_sport
    activity.start_utc = parsed.start_utc
    activity.timezone = parsed.timezone
    activity.duration_s = parsed.duration_s
    streams = parsed.streams
    activity.moving_s = metrics.moving_time(streams.t, streams.speed) or parsed.timer_s
    activity.distance_m = parsed.distance_m
    activity.ascent_m = parsed.ascent_m
    activity.descent_m = parsed.descent_m
    activity.avg_hr = parsed.avg_hr
    activity.max_hr = parsed.max_hr
    activity.avg_power = parsed.avg_power
    activity.normalized_power = parsed.normalized_power
    activity.calories = parsed.calories
    activity.training_effect = parsed.training_effect
    activity.device = parsed.device
    activity.has_gps = parsed.has_gps
    activity.bbox = parsed.bbox
    activity.route_simplified = route_polyline(parsed.streams)
    activity.sets = [
        {
            "start_s": s.start_s,
            "duration_s": s.duration_s,
            "kind": s.kind,
            "reps": s.reps,
            "weight_kg": s.weight_kg,
            "category": s.category,
        }
        for s in parsed.sets
    ] or None
    activity.splits = [
        {
            "distance_m": round(split.distance_m, 1),
            "time_s": round(split.time_s, 1),
            "elevation_change_m": None
            if split.elevation_change_m is None
            else round(split.elevation_change_m, 1),
            "avg_hr": None if split.avg_hr is None else round(split.avg_hr),
        }
        for split in metrics.splits(streams.t, streams.dist, streams.alt, streams.hr)
    ] or None


def _write_children(session: Session, activity: Activity, parsed: ParsedActivity) -> None:
    session.execute(delete(Lap).where(Lap.activity_id == activity.id))
    session.execute(delete(Stream).where(Stream.activity_id == activity.id))
    session.execute(delete(BestEffort).where(BestEffort.activity_id == activity.id))
    if activity.sport in BEST_EFFORT_SPORTS and not parsed.distance_from_gps:
        for effort in metrics.best_efforts(parsed.streams.t, parsed.streams.dist):
            session.add(
                BestEffort(
                    activity_id=activity.id,
                    distance_key=effort.key,
                    user_id=activity.user_id,
                    distance_m=effort.distance_m,
                    time_s=round(effort.time_s, 1),
                    start_s=effort.start_s,
                    start_distance_m=effort.start_distance_m,
                )
            )
    for index, lap in enumerate(parsed.laps):
        session.add(
            Lap(
                activity_id=activity.id,
                idx=index,
                user_id=activity.user_id,
                start_utc=lap.start_utc,
                duration_s=lap.duration_s,
                distance_m=lap.distance_m,
                avg_hr=lap.avg_hr,
                max_hr=lap.max_hr,
                avg_power=lap.avg_power,
                ascent_m=lap.ascent_m,
                descent_m=lap.descent_m,
            )
        )
    if len(parsed.streams):
        data, series = encode_streams(parsed.streams)
        session.add(
            Stream(
                activity_id=activity.id,
                user_id=activity.user_id,
                encoding=ENCODING,
                series=series,
                sample_count=len(parsed.streams),
                data=data,
            )
        )


def same_start(
    session: Session, user_id: int, parsed: ParsedActivity, sources: tuple[str, ...]
) -> Activity | None:
    """An activity of `sources` that started within two minutes of this one."""
    return session.scalars(
        select(Activity)
        .where(
            Activity.user_id == user_id,
            Activity.source.in_(sources),
            Activity.start_utc.between(parsed.start_utc - SAME_START, parsed.start_utc + SAME_START),
        )
        .limit(1)
    ).first()


def default_gear(session: Session, user_id: int, sport: str) -> int | None:
    """The gear that new activities of this sport get (OS-410), if any: of the active gear that is the
    default for this sport, the habitual one first, then the newest."""
    rows = session.scalars(
        select(Gear)
        .where(Gear.user_id == user_id, Gear.retired_at.is_(None))
        .order_by(Gear.habitual.desc(), Gear.id.desc())
    )
    return next((g.id for g in rows if sport in (g.sports or [])), None)


def stored_format(activity: Activity) -> str:
    path = activity.fit_path or ""
    return path.rsplit(".", 1)[-1] if path.endswith((".tcx", ".gpx")) else "fit"


def ingest_fit(
    session: Session,
    store: RawStore,
    *,
    user_id: int,
    source: str,
    external_id: str,
    fit: bytes,
    meta: dict[str, Any] | None = None,
    reprocess: bool = False,
) -> IngestResult:
    """Store and import one FIT activity. The caller commits the session."""
    return ingest_file(
        session,
        store,
        user_id=user_id,
        source=source,
        external_id=external_id,
        data=fit,
        fmt="fit",
        meta=meta,
        reprocess=reprocess,
    )


def ingest_file(
    session: Session,
    store: RawStore,
    *,
    user_id: int,
    source: str,
    external_id: str,
    data: bytes,
    fmt: str = "fit",
    meta: dict[str, Any] | None = None,
    reprocess: bool = False,
    parsed: ParsedActivity | None = None,
    name: str | None = None,
) -> IngestResult:
    """Store and import one activity file (FIT, TCX or GPX, uncompressed). The caller commits.

    A Garmin activity that matches one already imported from Strava or a file (same start, within two
    minutes) takes that activity over: its file is replaced by Garmin's and what the import added (name,
    description, gear, photos, weather) stays.
    """
    existing = session.scalar(
        select(Activity).where(
            Activity.user_id == user_id, Activity.source == source, Activity.external_id == external_id
        )
    )
    if existing is not None and not reprocess:
        return IngestResult(existing.id, created=False)

    merged = False
    if existing is None:
        parsed = parsed or parse_file(data, fmt)
        if source == "garmin":
            adopted = same_start(session, user_id, parsed, ADOPTABLE)
            if adopted is not None:
                adopted.raw_meta = {**(adopted.raw_meta or {}), "replaced": adopted.source}
                adopted.source, adopted.external_id = source, external_id
                existing, merged = adopted, True

    key = raw_key(user_id, source, external_id, fmt)
    stored = store.put(key, data)
    if parsed is None or (existing is not None and not merged):
        parsed = parse_file(store.get(key, stored.sha256), fmt)

    activity = existing or Activity(user_id=user_id, source=source, external_id=external_id)
    _apply(activity, parsed)
    if existing is None:
        activity.name = name or _name(parsed, meta)
        activity.gear_id = default_gear(session, user_id, activity.sport)
    activity.fit_path = stored.key
    activity.fit_sha256 = stored.sha256
    if meta is not None:
        activity.raw_meta = meta
    session.add(activity)
    session.flush()
    _write_children(session, activity, parsed)
    log.info(
        "Activity imported" if existing is None else "Activity merged" if merged else "Activity reprocessed",
        extra={
            "activity_id": activity.id,
            "source": source,
            "sport": parsed.sport,
            "samples": len(parsed.streams),
        },
    )
    from zankup.engine.run import queue_activity

    queue_activity(session, user_id, activity.id)  # the engine takes it from here (OS-313)
    return IngestResult(
        activity.id,
        created=existing is None,
        reprocessed=existing is not None and not merged,
        merged=merged,
    )
