"""FIT file → normalised activity (OS-105).

The result is a plain data structure, independent of the database: the ingestion (OS-106) stores it and
the metrics engine reads it. Units are SI throughout: metres, seconds, m/s, degrees, watts, °C.

Conventions:
- Positions come in semicircles and are converted to degrees.
- Running and walking cadence is stored as steps per minute (the FIT file stores strides, so times 2,
  plus the fractional part when present), cycling cadence as revolutions per minute.
- `enhanced_*` fields (wider range) win over the plain ones.
- Streams keep the samples as recorded (1 Hz, or every few seconds with "smart recording"), with `t` in
  seconds from the start.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

import fitdecode

SEMICIRCLE_TO_DEG = 180 / 2**31
STEP_SPORTS = {"run", "walk"}

SPORTS = {
    "running": "run",
    "cycling": "ride",
    "e_biking": "ride",
    "training": "strength",
    "fitness_equipment": "strength",
    "walking": "walk",
    "hiking": "walk",
    "rowing": "row",
    "swimming": "swim",
}
SUB_SPORT_OVERRIDES = {"indoor_rowing": "row", "strength_training": "strength", "indoor_walking": "walk"}


class FitParseError(ValueError):
    """The file is not a FIT activity we can read."""


@dataclass
class Lap:
    start_utc: datetime
    duration_s: float
    distance_m: float | None = None
    avg_hr: int | None = None
    max_hr: int | None = None
    avg_power: int | None = None
    ascent_m: float | None = None
    descent_m: float | None = None


@dataclass
class Streams:
    """Columnar series, one entry per record. Missing values are None."""

    t: list[float] = field(default_factory=list)
    lat: list[float | None] = field(default_factory=list)
    lon: list[float | None] = field(default_factory=list)
    dist: list[float | None] = field(default_factory=list)
    alt: list[float | None] = field(default_factory=list)
    hr: list[int | None] = field(default_factory=list)
    cad: list[float | None] = field(default_factory=list)
    speed: list[float | None] = field(default_factory=list)
    power: list[int | None] = field(default_factory=list)
    temp: list[float | None] = field(default_factory=list)

    SERIES = ("t", "lat", "lon", "dist", "alt", "hr", "cad", "speed", "power", "temp")

    def __len__(self) -> int:
        return len(self.t)

    def present(self) -> list[str]:
        """Series with at least one value (always includes `t`)."""
        return [name for name in self.SERIES if any(v is not None for v in getattr(self, name))]


@dataclass
class ParsedActivity:
    sport: str
    sub_sport: str | None
    start_utc: datetime
    utc_offset_s: int | None
    duration_s: float
    timer_s: float
    distance_m: float | None
    ascent_m: float | None
    descent_m: float | None
    avg_hr: int | None
    max_hr: int | None
    avg_power: int | None
    normalized_power: int | None
    avg_cadence: float | None
    calories: int | None
    training_effect: float | None
    device: str | None
    laps: list[Lap]
    streams: Streams

    @property
    def has_gps(self) -> bool:
        return any(v is not None for v in self.streams.lat)

    @property
    def bbox(self) -> list[float] | None:
        """[min_lat, min_lon, max_lat, max_lon] of the track, or None without GPS."""
        points = [
            (a, o)
            for a, o in zip(self.streams.lat, self.streams.lon, strict=True)
            if a is not None and o is not None
        ]
        if not points:
            return None
        lats, lons = [p[0] for p in points], [p[1] for p in points]
        return [min(lats), min(lons), max(lats), max(lons)]

    @property
    def timezone(self) -> str | None:
        """Offset of the local time when recorded, e.g. "+01:00"."""
        if self.utc_offset_s is None:
            return None
        sign = "+" if self.utc_offset_s >= 0 else "-"
        minutes = abs(self.utc_offset_s) // 60
        return f"{sign}{minutes // 60:02d}:{minutes % 60:02d}"


def _num(value: Any) -> float | None:
    return float(value) if isinstance(value, int | float) else None


def _int(value: Any) -> int | None:
    return round(value) if isinstance(value, int | float) else None


def _degrees(value: Any) -> float | None:
    return value * SEMICIRCLE_TO_DEG if isinstance(value, int) else None


def _first(values: dict[str, Any], *names: str) -> Any:
    for name in names:
        if values.get(name) is not None:
            return values[name]
    return None


def normalise_sport(sport: Any, sub_sport: Any) -> str:
    if isinstance(sub_sport, str) and sub_sport in SUB_SPORT_OVERRIDES:
        return SUB_SPORT_OVERRIDES[sub_sport]
    return SPORTS.get(sport, "other") if isinstance(sport, str) else "other"


def _device_name(file_id: dict[str, Any], creator: dict[str, Any]) -> str | None:
    name = _first(creator, "product_name") or _first(file_id, "product_name")
    if name:
        return str(name)
    product = _first(creator, "garmin_product") or _first(file_id, "garmin_product")
    manufacturer = _first(creator, "manufacturer") or _first(file_id, "manufacturer")
    if isinstance(product, str):
        return f"{str(manufacturer).title() + ' ' if isinstance(manufacturer, str) else ''}{product}"
    return str(manufacturer) if isinstance(manufacturer, str) else None


def parse_fit(data: bytes) -> ParsedActivity:
    """Parse a FIT activity file. Raises FitParseError if it is unreadable or has no session."""
    session: dict[str, Any] | None = None
    file_id: dict[str, Any] = {}
    creator: dict[str, Any] = {}
    activity: dict[str, Any] = {}
    raw_laps: list[dict[str, Any]] = []
    records: list[dict[str, Any]] = []

    try:
        with fitdecode.FitReader(io.BytesIO(data), check_crc=fitdecode.CrcCheck.WARN) as reader:
            for message in reader:
                if not isinstance(message, fitdecode.FitDataMessage):
                    continue
                values = {f.name: f.value for f in message.fields}
                match message.name:
                    case "record":
                        records.append(values)
                    case "lap":
                        raw_laps.append(values)
                    case "session" if session is None:  # multisport files: the first session for now
                        session = values
                    case "file_id":
                        file_id = values
                    case "activity":
                        activity = values
                    case "device_info" if values.get("device_index") == "creator" and not creator:
                        creator = values
    except fitdecode.FitError as error:
        raise FitParseError(f"Unreadable FIT file: {error}") from error
    if session is None:
        raise FitParseError("The FIT file has no session: not an activity")

    start: datetime | None = session.get("start_time") or (records[0]["timestamp"] if records else None)
    if start is None:
        raise FitParseError("The FIT file has no start time")
    sport = normalise_sport(session.get("sport"), session.get("sub_sport"))

    offset = None
    local, utc = activity.get("local_timestamp"), activity.get("timestamp")
    if isinstance(local, datetime) and isinstance(utc, datetime):
        delta = local.replace(tzinfo=None) - utc.replace(tzinfo=None)
        offset = round(delta / timedelta(minutes=15)) * 15 * 60  # time zones are multiples of 15 min

    avg_cadence = _num(_first(session, "avg_running_cadence", "avg_cadence"))
    if avg_cadence is not None and sport in STEP_SPORTS:
        avg_cadence = avg_cadence * 2 + 2 * (_num(session.get("avg_fractional_cadence")) or 0.0)

    streams = Streams()
    for record in records:
        timestamp = record.get("timestamp")
        if not isinstance(timestamp, datetime):
            continue
        cadence = _num(record.get("cadence"))
        if cadence is not None and sport in STEP_SPORTS:
            cadence = cadence * 2 + 2 * (_num(record.get("fractional_cadence")) or 0.0)
        streams.t.append((timestamp - start).total_seconds())
        streams.lat.append(_degrees(record.get("position_lat")))
        streams.lon.append(_degrees(record.get("position_long")))
        streams.dist.append(_num(record.get("distance")))
        streams.alt.append(_num(_first(record, "enhanced_altitude", "altitude")))
        streams.hr.append(_int(record.get("heart_rate")))
        streams.cad.append(cadence)
        streams.speed.append(_num(_first(record, "enhanced_speed", "speed")))
        streams.power.append(_int(record.get("power")))
        streams.temp.append(_num(record.get("temperature")))

    laps = [
        Lap(
            start_utc=lap["start_time"],
            duration_s=float(_first(lap, "total_timer_time", "total_elapsed_time") or 0.0),
            distance_m=_num(lap.get("total_distance")),
            avg_hr=_int(lap.get("avg_heart_rate")),
            max_hr=_int(lap.get("max_heart_rate")),
            avg_power=_int(lap.get("avg_power")),
            ascent_m=_num(lap.get("total_ascent")),
            descent_m=_num(lap.get("total_descent")),
        )
        for lap in raw_laps
        if isinstance(lap.get("start_time"), datetime)
    ]

    timer = float(_first(session, "total_timer_time", "total_elapsed_time") or 0.0)
    return ParsedActivity(
        sport=sport,
        sub_sport=session.get("sub_sport") if isinstance(session.get("sub_sport"), str) else None,
        start_utc=start,
        utc_offset_s=offset,
        duration_s=float(_first(session, "total_elapsed_time", "total_timer_time") or timer),
        timer_s=timer,
        distance_m=_num(session.get("total_distance")),
        ascent_m=_num(session.get("total_ascent")),
        descent_m=_num(session.get("total_descent")),
        avg_hr=_int(session.get("avg_heart_rate")),
        max_hr=_int(session.get("max_heart_rate")),
        avg_power=_int(session.get("avg_power")),
        normalized_power=_int(session.get("normalized_power")),
        avg_cadence=avg_cadence,
        calories=_int(session.get("total_calories")),
        training_effect=_num(session.get("total_training_effect")),
        device=_device_name(file_id, creator),
        laps=laps,
        streams=streams,
    )
