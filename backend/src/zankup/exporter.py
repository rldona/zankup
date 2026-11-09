"""Export all your data (OS-411): one ZIP you can keep, read anywhere or import elsewhere.

    README.txt
    profile.json, settings.json            who you are and your preferences (no secrets)
    activities.json                        every activity with its laps, splits, best efforts,
                                           metrics, gear and photos
    originals/<date>_<id>.<fit|tcx|gpx>    the original files, byte for byte
    streams/<id>.json                      the recorded series (also for activities without a file)
    photos/<activity id>_<photo id>.jpg
    gear.json, goals.json, segments.json, estimates.json, daily_load.json, events.json

The ZIP is written under DATA_DIR/exports and kept for seven days.
"""

from __future__ import annotations

import json
import logging
import zipfile
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session, sessionmaker

from zankup.db.models import (
    Activity,
    ActivityMetrics,
    BestEffort,
    DailyLoad,
    EstimateRow,
    Event,
    ExportRow,
    Gear,
    Goal,
    Lap,
    Photo,
    Segment,
    SegmentEffort,
    Stream,
    User,
    UserSettings,
)
from zankup.fit.streams import decode_streams
from zankup.photos import PhotoStore
from zankup.storage import RawStore, StorageError

log = logging.getLogger("zankup.exporter")

KEEP = timedelta(days=7)
PRIVATE_USER_FIELDS = {"password_hash", "totp_secret_enc", "totp_last_counter", "google_sub"}

README = """Zankup export of {email}, made on {day}.

activities.json has every activity; "original" is its file in originals/ (FIT, TCX or GPX, exactly
as received), "streams" the recorded series in streams/ and "photos" its photos in photos/.
Units are SI: metres, seconds, metres per second, watts, beats per minute.
Times are UTC (ISO 8601); "timezone" is the local offset when the activity was recorded.
"""


def _plain(value: Any) -> Any:
    if isinstance(value, datetime | date):
        return value.isoformat()
    return value


def row_dict(row: Any, skip: set[str] | None = None) -> dict[str, Any]:
    columns = inspect(row).mapper.column_attrs
    return {c.key: _plain(getattr(row, c.key)) for c in columns if c.key not in (skip or set())}


def _dump(archive: zipfile.ZipFile, name: str, data: Any) -> None:
    archive.writestr(name, json.dumps(data, ensure_ascii=False, indent=1))


def write_export(session: Session, store: RawStore, photos: PhotoStore, user_id: int, path: Path) -> None:
    user = session.get_one(User, user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    gear_names = {g.id: g.name for g in session.scalars(select(Gear).where(Gear.user_id == user_id))}
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        archive.writestr("README.txt", README.format(email=user.email, day=date.today().isoformat()))
        _dump(archive, "profile.json", row_dict(user, PRIVATE_USER_FIELDS))
        settings = session.get(UserSettings, user_id)
        _dump(archive, "settings.json", row_dict(settings) if settings else {})
        activities = []
        for activity in session.scalars(
            select(Activity).where(Activity.user_id == user_id).order_by(Activity.start_utc)
        ):
            item = row_dict(activity, {"route_simplified"})
            item["gear"] = gear_names.get(activity.gear_id) if activity.gear_id else None
            item["laps"] = [
                row_dict(lap, {"user_id", "activity_id"})
                for lap in session.scalars(
                    select(Lap).where(Lap.activity_id == activity.id).order_by(Lap.idx)
                )
            ]
            item["best_efforts"] = [
                row_dict(e, {"user_id", "activity_id"})
                for e in session.scalars(select(BestEffort).where(BestEffort.activity_id == activity.id))
            ]
            metrics = session.get(ActivityMetrics, activity.id)
            item["metrics"] = row_dict(metrics, {"activity_id"}) if metrics else None
            if activity.fit_path:
                fmt = activity.fit_path.rsplit(".", 1)[-1]
                name = f"originals/{activity.start_utc:%Y-%m-%d}_{activity.id}.{fmt}"
                try:
                    archive.writestr(name, store.get(activity.fit_path, activity.fit_sha256))
                    item["original"] = name
                except StorageError:
                    log.warning("Original missing from the export", extra={"activity_id": activity.id})
                    item["original"] = None
            stream = session.scalar(select(Stream.data).where(Stream.activity_id == activity.id))
            if stream is not None:
                archive.writestr(f"streams/{activity.id}.json", json.dumps(decode_streams(stream)))
                item["streams"] = f"streams/{activity.id}.json"
            item["photos"] = []
            for photo in session.scalars(select(Photo).where(Photo.activity_id == activity.id)):
                name = f"photos/{activity.id}_{photo.id}.jpg"
                try:
                    archive.writestr(name, photos.read(photo.key))
                except OSError:
                    continue
                item["photos"].append({"file": name, "caption": photo.caption})
            activities.append(item)
        _dump(archive, "activities.json", activities)
        _dump(
            archive,
            "gear.json",
            [row_dict(g) for g in session.scalars(select(Gear).where(Gear.user_id == user_id))],
        )
        _dump(
            archive,
            "goals.json",
            [row_dict(g) for g in session.scalars(select(Goal).where(Goal.user_id == user_id))],
        )
        segments = []
        for segment in session.scalars(select(Segment).where(Segment.user_id == user_id)):
            item = row_dict(segment)
            item["efforts"] = [
                row_dict(e)
                for e in session.scalars(select(SegmentEffort).where(SegmentEffort.segment_id == segment.id))
            ]
            segments.append(item)
        _dump(archive, "segments.json", segments)
        _dump(
            archive,
            "estimates.json",
            [
                row_dict(e)
                for e in session.scalars(
                    select(EstimateRow).where(EstimateRow.user_id == user_id).order_by(EstimateRow.day)
                )
            ],
        )
        _dump(
            archive,
            "daily_load.json",
            [
                row_dict(d)
                for d in session.scalars(
                    select(DailyLoad).where(DailyLoad.user_id == user_id).order_by(DailyLoad.day)
                )
            ],
        )
        _dump(
            archive,
            "events.json",
            [row_dict(e) for e in session.scalars(select(Event).where(Event.user_id == user_id))],
        )
    tmp.replace(path)


def run_export(
    sessions: sessionmaker[Session], store: RawStore, photos: PhotoStore, root: Path, export_id: int
) -> None:
    """The `export` job."""
    with sessions.begin() as session:
        row = session.get_one(ExportRow, export_id)
        row.status = "running"
        user_id = row.user_id
    relative = f"{user_id}/{export_id}.zip"
    try:
        with sessions() as session:
            write_export(session, store, photos, user_id, root / relative)
    except Exception as error:
        log.exception("Export failed", extra={"export_id": export_id})
        with sessions.begin() as session:
            row = session.get_one(ExportRow, export_id)
            row.status, row.error, row.finished_at = "error", str(error)[:500], datetime.now(UTC)
        return
    with sessions.begin() as session:
        row = session.get_one(ExportRow, export_id)
        row.status, row.path = "done", relative
        row.size = (root / relative).stat().st_size
        row.finished_at = datetime.now(UTC)
        row.expires_at = row.finished_at + KEEP
    log.info("Export ready", extra={"export_id": export_id})
