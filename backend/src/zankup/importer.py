"""Imports of uploaded files (OS-404) and of a Strava export (OS-406).

An upload is one file: a FIT, TCX or GPX (gzipped or not), or a ZIP. A ZIP with `activities.csv` at
its root (or in one folder) is a Strava bulk export; any other ZIP is searched for activity files,
including the ZIPs inside it (a Garmin Connect export keeps its FITs in nested ZIPs).

Loose files (source `file`) are identified by their SHA-256, so the same file twice is one activity,
and skipped when another activity started within two minutes on the same device (or an unknown one).

A Strava export, row by row of `activities.csv`:

- If an activity from Garmin (or a file) started within two minutes, Garmin's FIT wins: that activity
  keeps its data and gets the name, description, gear, photos and weather from Strava ("merged").
- Otherwise the row's file is imported (source `strava`, Strava's activity ID), or, without a file
  (manual entries, strength sessions recorded with another app), an activity is created from the CSV
  totals.
- Strava's own Relative Effort, calories and grade-adjusted distance are kept in `activities.strava`
  as references to compare our metrics with (OS-323), never shown as ours.
- Shoes and bikes come from `shoes.csv`, `bikes.csv` and the gear named on each activity (OS-410),
  photos from `media/` (OS-412) and privacy zones from `privacy_zones.csv` (OS-407).

Importing the same export again changes nothing: rows already imported are skipped. Each row is its
own transaction, so an interrupted import keeps what it did and can be run again.
"""

from __future__ import annotations

import csv
import io
import logging
import re
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path, PurePosixPath
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from zankup.db.models import Activity, Gear, ImportRow, Photo, UserSettings
from zankup.fit.files import file_format, gunzip, parse_file
from zankup.fit.parser import FitParseError
from zankup.ingest import SAME_START, ingest_file, same_start
from zankup.photos import PHOTO_TYPES, PhotoError, PhotoStore
from zankup.storage import RawStore, sha256

log = logging.getLogger("zankup.importer")

MAX_ENTRY = 200 * 1024 * 1024  # an activity file or photo larger than this is not one
MAX_DEPTH = 2  # ZIPs inside ZIPs
MAX_ERRORS = 50
SHOE_LIMIT_M = 800_000.0

# Strava's activities.csv has the same 100+ columns in every language: they are read by position.
COL = {
    "id": 0,
    "date": 1,
    "name": 2,
    "type": 3,
    "description": 4,
    "gear": 11,
    "file": 12,
    "elapsed": 15,
    "moving": 16,
    "distance": 17,
    "max_speed": 18,
    "ascent": 20,
    "descent": 21,
    "max_hr": 30,
    "avg_hr": 31,
    "avg_power": 33,
    "calories": 34,
    "relative_effort": 37,
    "perceived_effort": 43,
    "weighted_power": 46,
    "commute": 50,
    "grade_adjusted_distance": 53,
    "weather_condition": 55,
    "weather_temperature": 56,
    "apparent_temperature": 57,
    "humidity": 59,
    "wind_speed": 61,
    "wind_direction": 63,
    "media": 102,
    "tags": 103,
}
MIN_COLUMNS = 103

STRAVA_TYPES = {
    "run": {"carrera", "run", "trail run", "carrera de montaña", "virtual run", "carrera virtual"},
    "ride": {
        "bicicleta",
        "ride",
        "bicicleta virtual",
        "virtual ride",
        "bicicleta de montaña",
        "mountain bike ride",
        "gravel ride",
        "bicicleta de gravilla",
        "e-bike ride",
        "bicicleta eléctrica",
        "handcycle",
        "velomobile",
    },
    "strength": {"entrenamiento con pesas", "weight training", "crossfit"},
    "walk": {"caminata", "walk", "senderismo", "hike"},
    "row": {"remo", "rowing", "virtual row", "remo virtual"},
    "swim": {"natación", "swim"},
}
SPORT_OF_TYPE = {name: sport for sport, names in STRAVA_TYPES.items() for name in names}

MONTHS = {
    # Spanish
    "ene": 1,
    "feb": 2,
    "mar": 3,
    "abr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "ago": 8,
    "sept": 9,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dic": 12,
    # English
    "jan": 1,
    "apr": 4,
    "aug": 8,
    "dec": 12,
}
ES_DATE = re.compile(r"^(\d{1,2}) ([a-zé]+)\.? (\d{4}), (\d{1,2}):(\d{2}):(\d{2})$")
EN_DATE = re.compile(r"^([A-Za-z]+) (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2}):(\d{2}) ?([AP]M)?$")


class UploadError(ValueError):
    """The upload cannot be imported at all (not a ZIP or activity file, a broken export…)."""


@dataclass
class Counts:
    total: int = 0
    processed: int = 0
    created: int = 0
    merged: int = 0
    skipped: int = 0
    failed: int = 0
    photos: int = 0
    errors: list[dict[str, str]] = field(default_factory=list)

    def error(self, name: str, message: str) -> None:
        self.failed += 1
        if len(self.errors) < MAX_ERRORS:
            self.errors.append({"file": name[:200], "error": message[:300]})


# --- small parsers ---------------------------------------------------------------------------------


def strava_date(value: str) -> datetime | None:
    """Strava's CSV dates are UTC, written in the account's language: "27 oct 2026, 17:21:00" or
    "Oct 27, 2026, 5:21:00 PM"."""
    value = value.strip()
    if match := ES_DATE.match(value.lower()):
        day, month, year, hour, minute, second = match.groups()
        number = MONTHS.get(month[:4]) or MONTHS.get(month[:3])
        if number is None:
            return None
        return datetime(int(year), number, int(day), int(hour), int(minute), int(second), tzinfo=UTC)
    if match := EN_DATE.match(value):
        month, day, year, hour, minute, second, half = match.groups()
        number = MONTHS.get(month[:3].lower())
        if number is None:
            return None
        h = int(hour) % 12 + (12 if half == "PM" else 0) if half else int(hour)
        return datetime(int(year), number, int(day), h, int(minute), int(second), tzinfo=UTC)
    return None


def _number(row: list[str], name: str) -> float | None:
    try:
        value = row[COL[name]].strip()
    except IndexError:
        return None
    if not value:
        return None
    try:
        return float(value.replace(",", ".")) if value.count(",") == 1 and "." not in value else float(value)
    except ValueError:
        return None


def _text(row: list[str], name: str) -> str:
    try:
        return row[COL[name]].strip()
    except IndexError:
        return ""


def strava_sport(row: list[str]) -> str | None:
    return SPORT_OF_TYPE.get(_text(row, "type").lower())


def _references(row: list[str]) -> dict[str, Any]:
    """What Strava computed for this activity, kept as references (OS-323) and for display (weather)."""
    refs: dict[str, Any] = {"id": _text(row, "id")}
    for key in ("relative_effort", "calories", "grade_adjusted_distance", "perceived_effort", "moving"):
        if (value := _number(row, key)) is not None:
            refs[key] = value
    weather: dict[str, float | str] = {
        key: value
        for key in ("weather_temperature", "apparent_temperature", "humidity", "wind_speed", "wind_direction")
        if (value := _number(row, key)) is not None
    }
    if condition := _text(row, "weather_condition"):
        weather["condition"] = condition
    if weather:
        refs["weather"] = {k.removeprefix("weather_"): v for k, v in weather.items()}
    if gear := _text(row, "gear"):
        refs["gear"] = gear
    if _text(row, "commute").lower() in ("true", "1.0", "1"):
        refs["commute"] = True
    return refs


# --- archives ---------------------------------------------------------------------------------------


def _read(archive: zipfile.ZipFile, info: zipfile.ZipInfo) -> bytes:
    if info.file_size > MAX_ENTRY:
        raise UploadError(f"{info.filename} is too large")
    with archive.open(info) as entry:
        data = entry.read(MAX_ENTRY + 1)
    if len(data) > MAX_ENTRY:
        raise UploadError(f"{info.filename} is too large")
    return data


def activity_files(archive: zipfile.ZipFile, depth: int = 0) -> Iterator[tuple[str, str, bytes]]:
    """(name, format, uncompressed bytes) of every activity file in the archive and the ZIPs inside."""
    for info in archive.infolist():
        if info.is_dir():
            continue
        name = info.filename
        if name.lower().endswith(".zip") and depth < MAX_DEPTH:
            try:
                with zipfile.ZipFile(io.BytesIO(_read(archive, info))) as inner:
                    yield from activity_files(inner, depth + 1)
            except zipfile.BadZipFile:
                continue
            continue
        fmt = file_format(PurePosixPath(name).name)
        if fmt is not None:
            yield name, fmt, gunzip(_read(archive, info))


def strava_root(archive: zipfile.ZipFile) -> str | None:
    """The folder of the export inside the ZIP ("" at the root), if this is a Strava export."""
    for name in archive.namelist():
        path = PurePosixPath(name)
        if path.name == "activities.csv" and len(path.parts) <= 2:
            parent = str(path.parent)
            return "" if parent == "." else parent + "/"
    return None


# --- the import -------------------------------------------------------------------------------------


class Importer:
    def __init__(
        self,
        sessions: sessionmaker[Session],
        store: RawStore,
        photos: PhotoStore,
        user_id: int,
        import_id: int | None = None,
    ) -> None:
        self.sessions, self.store, self.photo_store = sessions, store, photos
        self.user_id, self.import_id = user_id, import_id
        self.counts = Counts()
        self.kind: str | None = None
        self.resumed = False  # an interrupted import running again: what it did is not "skipped"
        self._last_saved = datetime.min.replace(tzinfo=UTC)

    def resume(self, row: ImportRow) -> None:
        """Carry on from an interrupted run of the same import (a restart, a deploy)."""
        self.resumed = True
        self.counts = Counts(
            created=row.created,
            merged=row.merged,
            failed=row.failed,
            photos=row.photos,
            skipped=row.skipped,
            errors=list(row.errors or []),
        )

    # progress ----------------------------------------------------------------------------------------

    def save(self, session: Session, force: bool = False) -> None:
        now = datetime.now(UTC)
        if self.import_id is None or (not force and now - self._last_saved < timedelta(seconds=2)):
            return
        self._last_saved = now
        row = session.get(ImportRow, self.import_id)
        if row is None:
            return
        c = self.counts
        row.total, row.processed, row.created, row.merged = c.total, c.processed, c.created, c.merged
        row.skipped, row.failed, row.photos = c.skipped, c.failed, c.photos
        row.errors = list(c.errors) or None
        row.kind = row.kind or self.kind

    # entry point -------------------------------------------------------------------------------------

    def run(self, path: Path, filename: str) -> str:
        """Import the upload at `path`. Returns its kind: strava, archive or file."""
        if zipfile.is_zipfile(path):
            with zipfile.ZipFile(path) as archive:
                root = strava_root(archive)
                self.kind = "strava" if root is not None else "archive"
                if root is not None:
                    self.strava(archive, root)
                else:
                    self.archive(archive)
                return self.kind
        fmt = file_format(filename)
        if fmt is None:
            raise UploadError("Not a FIT, TCX, GPX or ZIP file")
        self.counts.total = 1
        with self.sessions.begin() as session:
            self.loose_file(session, filename, fmt, gunzip(path.read_bytes()))
            self.counts.processed += 1
            self.save(session, force=True)
        return "file"

    # loose files (OS-404) ----------------------------------------------------------------------------

    def archive(self, archive: zipfile.ZipFile) -> None:
        names = [
            i.filename
            for i in archive.infolist()
            if file_format(PurePosixPath(i.filename).name) or i.filename.lower().endswith(".zip")
        ]
        self.counts.total = len(names)
        for name, fmt, data in activity_files(archive):
            with self.sessions.begin() as session:
                self.loose_file(session, name, fmt, data)
                self.counts.processed += 1
                self.save(session)
        self.counts.total = max(self.counts.total, self.counts.processed)

    def loose_file(self, session: Session, name: str, fmt: str, data: bytes) -> None:
        external_id = sha256(data)[:32]
        exists = session.scalar(
            select(Activity.id).where(
                Activity.user_id == self.user_id,
                Activity.source == "file",
                Activity.external_id == external_id,
            )
        )
        if exists is not None:
            self.counts.skipped += 0 if self.resumed else 1
            return
        try:
            parsed = parse_file(data, fmt)
        except FitParseError as error:
            self.counts.error(name, str(error))
            return
        other = same_start(session, self.user_id, parsed, ("garmin", "strava", "file"))
        if other is not None and (not other.device or not parsed.device or other.device == parsed.device):
            self.counts.skipped += 1
            return
        try:
            with session.begin_nested():
                ingest_file(
                    session,
                    self.store,
                    user_id=self.user_id,
                    source="file",
                    external_id=external_id,
                    data=data,
                    fmt=fmt,
                    parsed=parsed,
                )
        except Exception as error:
            log.warning("File not imported", extra={"file": name, "error": str(error)[:200]})
            self.counts.error(name, str(error))
            return
        self.counts.created += 1

    # Strava export (OS-406) --------------------------------------------------------------------------

    def strava(self, archive: zipfile.ZipFile, root: str) -> None:
        names = set(archive.namelist())

        def table(name: str) -> list[list[str]]:
            if root + name not in names:
                return []
            text = _read(archive, archive.getinfo(root + name)).decode("utf-8-sig")
            return list(csv.reader(io.StringIO(text)))

        rows = table("activities.csv")
        if not rows or len(rows[0]) < MIN_COLUMNS:
            raise UploadError("activities.csv does not look like a Strava export")
        rows = [r for r in rows[1:] if r and r[0].strip()]
        self.counts.total = len(rows)
        captions = {r[0]: r[1] for r in table("media.csv")[1:] if len(r) > 1 and r[1] not in ("", "caption")}

        with self.sessions.begin() as session:
            gear = self.strava_gear(session, table("shoes.csv"), table("bikes.csv"), rows)
            self.strava_privacy_zones(session, table("privacy_zones.csv"))

        for row in rows:
            name = _text(row, "file") or f"activity {_text(row, 'id')}"
            try:
                with self.sessions.begin() as session:
                    self.strava_row(session, archive, root, row, gear, captions)
                    self.counts.processed += 1
                    self.save(session)
            except Exception as error:
                log.warning("Strava activity not imported", extra={"file": name, "error": str(error)[:200]})
                self.counts.error(name, str(error))
                self.counts.processed += 1

    def strava_row(
        self,
        session: Session,
        archive: zipfile.ZipFile,
        root: str,
        row: list[str],
        gear: dict[str, int],
        captions: dict[str, str],
    ) -> None:
        strava_id = _text(row, "id")
        already = session.scalar(
            select(Activity.id).where(
                Activity.user_id == self.user_id,
                (Activity.source == "strava") & (Activity.external_id == strava_id)
                | (Activity.strava["id"].astext == strava_id),
            )
        )
        if already is not None:
            self.counts.skipped += 0 if self.resumed else 1
            return
        start = strava_date(_text(row, "date"))
        activity: Activity | None = None
        if start is not None:
            activity = self._matching(session, start)
        if activity is not None:
            self.counts.merged += 1
        else:
            activity = self._strava_activity(session, archive, root, row, start)
            if activity is None:
                return
        self._enrich(session, activity, row, gear)
        self._photos(session, archive, root, activity, row, captions)

    def _matching(self, session: Session, start: datetime) -> Activity | None:
        return session.scalars(
            select(Activity)
            .where(
                Activity.user_id == self.user_id,
                Activity.source.in_(("garmin", "file")),
                Activity.start_utc.between(start - SAME_START, start + SAME_START),
            )
            .limit(1)
        ).first()

    def _strava_activity(
        self, session: Session, archive: zipfile.ZipFile, root: str, row: list[str], start: datetime | None
    ) -> Activity | None:
        strava_id = _text(row, "id")
        file_name = _text(row, "file")
        sport = strava_sport(row)
        name = _text(row, "name") or None
        if file_name and root + file_name in archive.namelist():
            fmt = file_format(PurePosixPath(file_name).name)
            if fmt is None:
                self.counts.error(file_name, "Unknown file type")
                return None
            data = gunzip(_read(archive, archive.getinfo(root + file_name)))
            try:
                parsed = parse_file(data, fmt)
            except FitParseError as error:
                self.counts.error(file_name, str(error))
                return None
            if start is None and (match := same_start(session, self.user_id, parsed, ("garmin", "file"))):
                self.counts.merged += 1
                return match
            original_sport = parsed.sport
            if sport is not None and sport != parsed.sport:
                parsed.sport = sport
                parsed.sub_sport = None
            if "virtual" in _text(row, "tags"):
                parsed.sub_sport = parsed.sub_sport or "virtual_activity"
            result = ingest_file(
                session,
                self.store,
                user_id=self.user_id,
                source="strava",
                external_id=strava_id,
                data=data,
                fmt=fmt,
                parsed=parsed,
                name=name,
            )
            activity = session.get_one(Activity, result.activity_id)
            if parsed.sport != original_sport:
                activity.edited_fields = sorted({*(activity.edited_fields or []), "sport"})
            self.counts.created += 1
            return activity
        if start is None:
            self.counts.error(file_name or strava_id, "No file and no readable date")
            return None
        elapsed = _number(row, "elapsed") or 0.0
        activity = Activity(
            user_id=self.user_id,
            source="strava",
            external_id=strava_id,
            name=name,
            sport=sport or "other",
            start_utc=start,
            duration_s=elapsed,
            moving_s=_number(row, "moving"),
            distance_m=_number(row, "distance") or None,
            ascent_m=_number(row, "ascent"),
            descent_m=_number(row, "descent"),
            avg_hr=round(v) if (v := _number(row, "avg_hr")) else None,
            max_hr=round(v) if (v := _number(row, "max_hr")) else None,
            avg_power=round(v) if (v := _number(row, "avg_power")) else None,
            calories=round(v) if (v := _number(row, "calories")) else None,
            edited_fields=["sport"] if sport else None,
        )
        session.add(activity)
        session.flush()
        from zankup.engine.run import queue_activity
        from zankup.ingest import default_gear

        activity.gear_id = default_gear(session, self.user_id, activity.sport)
        queue_activity(session, self.user_id, activity.id)
        self.counts.created += 1
        return activity

    def _enrich(self, session: Session, activity: Activity, row: list[str], gear: dict[str, int]) -> None:
        edited = set(activity.edited_fields or [])
        name, description = _text(row, "name"), _text(row, "description")
        if name and "name" not in edited:
            activity.name = name
        if description and "description" not in edited and not activity.description:
            activity.description = description
        if "gear" not in edited:  # Strava's gear, or none: never a default the person did not choose
            gear_name = _text(row, "gear")
            activity.gear_id = _gear_for(gear, gear_name) if gear_name else None
        activity.strava = _references(row)
        session.flush()

    def _photos(
        self,
        session: Session,
        archive: zipfile.ZipFile,
        root: str,
        activity: Activity,
        row: list[str],
        captions: dict[str, str],
    ) -> None:
        paths = [p.strip() for p in _text(row, "media").split("|") if p.strip()]
        names = set(archive.namelist())
        position = session.scalar(select(func.count()).where(Photo.activity_id == activity.id)) or 0
        for path in paths:
            if not path.lower().endswith(PHOTO_TYPES) or root + path not in names:
                continue
            exists = session.scalar(
                select(Photo.id).where(Photo.activity_id == activity.id, Photo.source_name == path)
            )
            if exists is not None:
                continue
            try:
                saved = self.photo_store.save(self.user_id, _read(archive, archive.getinfo(root + path)))
            except (PhotoError, UploadError) as error:
                self.counts.error(path, str(error))
                continue
            session.add(
                Photo(
                    user_id=self.user_id,
                    activity_id=activity.id,
                    key=saved.key,
                    width=saved.width,
                    height=saved.height,
                    caption=captions.get(path),
                    source="strava",
                    source_name=path,
                    position=position,
                )
            )
            position += 1
            self.counts.photos += 1

    def strava_gear(
        self, session: Session, shoes: list[list[str]], bikes: list[list[str]], rows: list[list[str]]
    ) -> dict[str, int]:
        """Create the export's shoes and bikes (once) and return {name: gear id}."""
        existing = {g.name: g for g in session.scalars(select(Gear).where(Gear.user_id == self.user_id))}

        def add(kind: str, name: str, brand: str | None, model: str | None, defaults: str) -> None:
            name = name.strip()
            if not name or name in existing:
                return
            sports = sorted(
                {
                    SPORT_OF_TYPE[t.strip().lower()]
                    for t in defaults.split("|")
                    if t.strip().lower() in SPORT_OF_TYPE
                }
            )
            gear = Gear(
                user_id=self.user_id,
                kind=kind,
                name=name[:120],
                brand=(brand or "").strip()[:120] or None,
                model=(model or "").strip()[:120] or None,
                sports=sports or None,
                limit_m=SHOE_LIMIT_M if kind == "shoe" else None,
            )
            session.add(gear)
            existing[name] = gear

        for row in shoes[1:]:
            if row:
                add(
                    "shoe",
                    row[0],
                    row[1] if len(row) > 1 else None,
                    row[2] if len(row) > 2 else None,
                    row[3] if len(row) > 3 else "",
                )
        for row in bikes[1:]:
            if row:
                add(
                    "bike",
                    row[0],
                    row[1] if len(row) > 1 else None,
                    row[2] if len(row) > 2 else None,
                    row[3] if len(row) > 3 else "",
                )
        session.flush()
        names = {g.name: g.id for g in existing.values()}
        # Gear named on activities but missing from the CSVs (deleted on Strava, for example).
        for row in rows:
            gear_name = _text(row, "gear")
            if gear_name and _gear_for(names, gear_name) is None:
                sport = strava_sport(row)
                add(
                    "bike" if sport == "ride" else "shoe" if sport in ("run", "walk") else "other",
                    gear_name,
                    None,
                    None,
                    "",
                )
                session.flush()
                names = {g.name: g.id for g in existing.values()}
        return names

    def strava_privacy_zones(self, session: Session, rows: list[list[str]]) -> None:
        """Strava's privacy zones become Zankup's, unless some are already configured."""
        zones: list[dict[str, Any]] = []
        for row in rows[1:]:
            if len(row) < 3:
                continue
            try:
                lat, lon = (float(v) for v in row[2].split(","))
            except ValueError:
                continue
            radius = re.match(r"([\d.,]+)\s*(\S+)", row[1].strip())
            meters = 500.0
            if radius:
                value = float(radius.group(1).replace(",", "."))
                unit = radius.group(2).lower()
                meters = value * (
                    1000 if unit.startswith(("k", "kil")) else 1609.34 if unit.startswith("mi") else 1
                )
            zones.append(
                {
                    "id": f"strava-{len(zones) + 1}",
                    "name": row[0][:120] or "Strava",
                    "lat": round(lat, 6),
                    "lon": round(lon, 6),
                    "radius_m": round(min(max(meters, 100.0), 5000.0)),
                }
            )
        if not zones:
            return
        settings = session.get(UserSettings, self.user_id)
        if settings is None:
            settings = UserSettings(user_id=self.user_id)
            session.add(settings)
        if not settings.privacy_zones:
            settings.privacy_zones = zones


def _gear_for(names: dict[str, int], label: str) -> int | None:
    """The gear an activity's gear label names. Strava writes "<brand> <model> <name>" for shoes and
    the plain name for bikes."""
    label = label.strip()
    if label in names:
        return names[label]
    best = max((n for n in names if label.endswith(" " + n)), key=len, default=None)
    return names[best] if best else None


def run_import(
    sessions: sessionmaker[Session], store: RawStore, photos: PhotoStore, import_id: int, path: Path
) -> None:
    """The `import_upload` job: import the stored upload and record the outcome on its row."""
    importer: Importer | None = None
    with sessions.begin() as session:
        row = session.get_one(ImportRow, import_id)
        importer = Importer(sessions, store, photos, row.user_id, import_id)
        if row.started_at is not None:
            importer.resume(row)
        row.status, row.started_at = "running", row.started_at or datetime.now(UTC)
        filename = row.filename
        user_id = row.user_id
    kind: str | None = None
    error: str | None = None
    try:
        kind = importer.run(path, filename)
    except (UploadError, zipfile.BadZipFile, FitParseError) as failure:
        error = str(failure)
    except Exception as failure:
        log.exception("Import failed", extra={"import_id": import_id})
        error = f"The import stopped: {str(failure)[:300]}"
    with sessions.begin() as session:
        importer.save(session, force=True)
        row = session.get_one(ImportRow, import_id)
        row.kind = kind
        row.status = "error" if error else "done"
        row.error = error
        row.finished_at = datetime.now(UTC)
        from zankup.notify import notify

        notify(
            session,
            user_id,
            "import",
            {
                "import_id": import_id,
                "created": importer.counts.created,
                "merged": importer.counts.merged,
                "error": bool(error),
            },
            key=f"import:{import_id}",
        )
    path.unlink(missing_ok=True)
    log.info("Import finished", extra={"import_id": import_id, "kind": kind, "error": error})
