"""TCX and GPX files → the same `ParsedActivity` as a FIT file (OS-404, OS-406).

Both formats only carry points (position, altitude, time and, with extensions, heart rate, cadence,
power and temperature); TCX also has laps and, usually, the cumulative distance. What they lack is
derived here:

- Distance, when the file has none: from the positions, smoothed with a moving average over
  `DISTANCE_SMOOTH` points so GPS noise does not add metres.
- Elevation gain: from the altitude smoothed over `ALTITUDE_SMOOTH` points with a `CLIMB_THRESHOLD_M`
  hysteresis, so a barometer's or GPS's jitter does not count as climbing (raw sums can be 70 % high).

Calibrated on 87 real activities by recomputing both from the positions and altitude of FIT files
and comparing with what the watch recorded: distance median 0.995 (10-90 %: 0.986-1.001), elevation
gain median 0.95 (0.87-1.03).

`distance_from_gps` tells the ingestion that distance came from positions: best efforts are not
computed from it.

Strava's TCX files have whitespace before the XML declaration, which is stripped before parsing.
"""

from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET
from datetime import UTC, datetime

from zankup.fit.parser import FitParseError, Lap, ParsedActivity, Streams

DISTANCE_SMOOTH = 3
ALTITUDE_SMOOTH = 5
CLIMB_THRESHOLD_M = 1.0
STEP_SPORTS = {"run", "walk"}
EARTH = 6_371_000.0

TCX_SPORTS = {"running": "run", "biking": "ride"}
GPX_SPORTS = {
    "running": "run",
    "run": "run",
    "trail_running": "run",
    "cycling": "ride",
    "biking": "ride",
    "ride": "ride",
    "walking": "walk",
    "walk": "walk",
    "hiking": "walk",
    "rowing": "row",
    "swimming": "swim",
    "9": "run",  # Strava's numeric GPX types
    "1": "ride",
    "10": "walk",
}


class XmlParseError(FitParseError):
    """The file is not a TCX or GPX activity we can read."""


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _children(element: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in element if _local(child.tag) == name]


def _child(element: ET.Element, name: str) -> ET.Element | None:
    return next((child for child in element if _local(child.tag) == name), None)


def _find_all(element: ET.Element, name: str) -> list[ET.Element]:
    return [e for e in element.iter() if _local(e.tag) == name]


def _text(element: ET.Element | None, name: str) -> str | None:
    if element is None:
        return None
    found = next((e for e in element.iter() if _local(e.tag) == name and e is not element), None)
    return found.text.strip() if found is not None and found.text else None


def _direct(element: ET.Element | None, name: str) -> str | None:
    found = _child(element, name) if element is not None else None
    return found.text.strip() if found is not None and found.text else None


def _float(value: str | None) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except ValueError:
        return None


def _time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _root(data: bytes) -> ET.Element:
    text = data.lstrip()  # Strava's TCX files start with spaces before <?xml
    if b"<!DOCTYPE" in text[:500] or b"<!ENTITY" in text[:2000]:
        raise XmlParseError("XML files with a DTD are not accepted")
    try:
        return ET.fromstring(text)
    except ET.ParseError as error:
        raise XmlParseError(f"Unreadable XML file: {error}") from error


def haversine(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * EARTH * math.asin(min(1.0, math.sqrt(h)))


def _smooth(values: list[float], window: int) -> list[float]:
    if len(values) < 3 or window < 2:
        return values
    half = window // 2
    out = []
    for i in range(len(values)):
        lo, hi = max(0, i - half), min(len(values), i + half + 1)
        out.append(sum(values[lo:hi]) / (hi - lo))
    return out


def gps_distance(lat: list[float | None], lon: list[float | None]) -> list[float | None]:
    """Cumulative distance from positions, smoothed. None until the first fix."""
    index = [i for i, (a, o) in enumerate(zip(lat, lon, strict=True)) if a is not None and o is not None]
    out: list[float | None] = [None] * len(lat)
    if not index:
        return out
    slat = _smooth([lat[i] for i in index], DISTANCE_SMOOTH)  # type: ignore[misc]
    slon = _smooth([lon[i] for i in index], DISTANCE_SMOOTH)  # type: ignore[misc]
    total = 0.0
    out[index[0]] = 0.0
    for k in range(1, len(index)):
        total += haversine((slat[k - 1], slon[k - 1]), (slat[k], slon[k]))
        out[index[k]] = total
    last = None  # carry the distance over points without a fix
    for i, value in enumerate(out):
        if value is None and last is not None:
            out[i] = last
        elif value is not None:
            last = value
    return out


def climb(alt: list[float | None]) -> tuple[float | None, float | None]:
    """Elevation gain and loss from the smoothed altitude, with a hysteresis threshold."""
    values = [a for a in alt if a is not None]
    if len(values) < 2:
        return None, None
    smooth = _smooth(values, ALTITUDE_SMOOTH)
    up = down = 0.0
    anchor = smooth[0]
    for value in smooth[1:]:
        if value - anchor >= CLIMB_THRESHOLD_M:
            up += value - anchor
            anchor = value
        elif anchor - value >= CLIMB_THRESHOLD_M:
            down += anchor - value
            anchor = value
    return round(up, 1), round(down, 1)


def _speed(t: list[float], dist: list[float | None]) -> list[float | None]:
    """Speed from the distance over a few seconds, so single-second jumps do not show."""
    out: list[float | None] = []
    j = 0
    for i in range(len(t)):
        while j < i and t[i] - t[j] > 10:
            j += 1
        d1, d0 = dist[i], dist[j]
        dt = t[i] - t[j]
        out.append((d1 - d0) / dt if d1 is not None and d0 is not None and dt > 0 else None)
    return out


def _finish(
    *,
    sport: str,
    sub_sport: str | None,
    start: datetime,
    offset_s: int | None,
    streams: Streams,
    laps: list[Lap],
    distance_m: float | None,
    calories: int | None,
    device: str | None,
    timer_s: float | None = None,
) -> ParsedActivity:
    from_gps = False
    if not any(d is not None for d in streams.dist) and any(a is not None for a in streams.lat):
        streams.dist = gps_distance(streams.lat, streams.lon)
        from_gps = True
    if not any(s is not None for s in streams.speed) and any(d is not None for d in streams.dist):
        streams.speed = _speed(streams.t, streams.dist)
    last_distance = next((d for d in reversed(streams.dist) if d is not None), None)
    if distance_m is None or from_gps:
        distance_m = last_distance
    up, down = climb(streams.alt)
    hrs = [h for h in streams.hr if h is not None]
    powers = [p for p in streams.power if p is not None]
    cads = [c for c in streams.cad if c is not None and c > 0]
    duration = streams.t[-1] if streams.t else (timer_s or 0.0)
    parsed = ParsedActivity(
        sport=sport,
        sub_sport=sub_sport,
        start_utc=start,
        utc_offset_s=offset_s,
        duration_s=float(duration),
        timer_s=float(timer_s if timer_s is not None else duration),
        distance_m=distance_m,
        ascent_m=up,
        descent_m=down,
        avg_hr=round(sum(hrs) / len(hrs)) if hrs else None,
        max_hr=max(hrs) if hrs else None,
        avg_power=round(sum(powers) / len(powers)) if powers else None,
        normalized_power=None,
        avg_cadence=sum(cads) / len(cads) if cads else None,
        calories=calories,
        training_effect=None,
        device=device,
        laps=laps,
        streams=streams,
    )
    parsed.distance_from_gps = from_gps
    return parsed


def _offset(value: str | None) -> int | None:
    """The UTC offset written in a timestamp such as 2026-11-06T18:14:35.000+01:00."""
    if not value or not re.search(r"[+-]\d{2}:\d{2}$", value):
        return None
    parsed = _time(value)
    delta = parsed.utcoffset() if parsed else None
    return int(delta.total_seconds()) if delta is not None else None


def parse_tcx(data: bytes) -> ParsedActivity:
    root = _root(data)
    activity = next(iter(_find_all(root, "Activity")), None)
    if activity is None:
        raise XmlParseError("The TCX file has no activity")
    sport = TCX_SPORTS.get((activity.get("Sport") or "").lower(), "other")
    raw_id = _direct(activity, "Id")
    points = _find_all(activity, "Trackpoint")
    times = [_time(_text(p, "Time")) for p in points]
    start = _time(raw_id) or next((t for t in times if t is not None), None)
    if start is None:
        raise XmlParseError("The TCX file has no start time")
    start = start.astimezone(UTC)

    streams = Streams()
    for point, time in zip(points, times, strict=True):
        if time is None:
            continue
        position = _child(point, "Position")
        hr = _child(point, "HeartRateBpm")
        cadence = _float(_text(point, "Cadence")) or _float(_text(point, "RunCadence"))
        if cadence is not None and sport in STEP_SPORTS and _text(point, "RunCadence") is not None:
            cadence *= 2
        streams.t.append((time - start).total_seconds())
        streams.lat.append(_float(_text(position, "LatitudeDegrees")))
        streams.lon.append(_float(_text(position, "LongitudeDegrees")))
        streams.dist.append(_float(_text(point, "DistanceMeters")))
        streams.alt.append(_float(_text(point, "AltitudeMeters")))
        streams.hr.append(round(v) if (v := _float(_text(hr, "Value"))) is not None else None)
        streams.cad.append(cadence)
        streams.speed.append(_float(_text(point, "Speed")))
        streams.power.append(round(v) if (v := _float(_text(point, "Watts"))) is not None else None)
        streams.temp.append(None)

    laps = []
    distance = 0.0
    calories = 0
    timer = 0.0
    for lap in _children(activity, "Lap"):
        began = _time(lap.get("StartTime"))
        seconds = _float(_direct(lap, "TotalTimeSeconds")) or 0.0
        meters = _float(_direct(lap, "DistanceMeters"))
        kcal = _float(_direct(lap, "Calories"))
        distance += meters or 0.0
        calories += round(kcal or 0)
        timer += seconds
        if began is None:
            continue
        avg = _child(lap, "AverageHeartRateBpm")
        top = _child(lap, "MaximumHeartRateBpm")
        laps.append(
            Lap(
                start_utc=began.astimezone(UTC),
                duration_s=seconds,
                distance_m=meters,
                avg_hr=round(v) if (v := _float(_text(avg, "Value"))) is not None else None,
                max_hr=round(v) if (v := _float(_text(top, "Value"))) is not None else None,
            )
        )
    creator = _child(activity, "Creator")
    return _finish(
        sport=sport,
        sub_sport=None,
        start=start,
        offset_s=_offset(raw_id),
        streams=streams,
        laps=laps,
        distance_m=distance or None,
        calories=calories or None,
        device=_text(creator, "Name"),
        timer_s=timer or None,
    )


def parse_gpx(data: bytes) -> ParsedActivity:
    root = _root(data)
    track = next(iter(_find_all(root, "trk")), None)
    if track is None:
        raise XmlParseError("The GPX file has no track")
    kind = (_text(track, "type") or "").lower()
    sport = GPX_SPORTS.get(kind, "other")
    points = _find_all(track, "trkpt")
    times = [_time(_text(p, "time")) for p in points]
    start = next((t for t in times if t is not None), None) or _time(_text(_child(root, "metadata"), "time"))
    if start is None:
        raise XmlParseError("The GPX file has no times")
    start = start.astimezone(UTC)
    streams = Streams()
    for point, time in zip(points, times, strict=True):
        if time is None:
            continue
        streams.t.append((time - start).total_seconds())
        streams.lat.append(_float(point.get("lat")))
        streams.lon.append(_float(point.get("lon")))
        streams.dist.append(None)
        streams.alt.append(_float(_text(point, "ele")))
        hr = _float(_text(point, "hr"))
        streams.hr.append(round(hr) if hr is not None else None)
        cadence = _float(_text(point, "cad"))
        streams.cad.append(cadence * 2 if cadence is not None and sport in STEP_SPORTS else cadence)
        streams.speed.append(None)
        power = _float(_text(point, "power"))
        streams.power.append(round(power) if power is not None else None)
        streams.temp.append(_float(_text(point, "atemp")))
    return _finish(
        sport=sport,
        sub_sport=None,
        start=start,
        offset_s=None,
        streams=streams,
        laps=[],
        distance_m=None,
        calories=None,
        device=root.get("creator"),
    )
