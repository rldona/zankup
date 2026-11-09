"""Privacy zones (OS-407): places (home, work) that nothing shared ever shows.

A zone is a circle (centre and radius, 100 m to 5 km). Whenever a route leaves Zankup in something
shareable (a share link, a share image, a month or year in review), every point inside a zone is
removed and the route is split there, so the line never crosses a zone either. The owner's own
screens are not trimmed.

The radius is enlarged by a fixed `JITTER_M`, so the edge of the hidden area does not sit exactly on
the configured circle: a route that stops at the same place every day would otherwise trace it.
"""

from __future__ import annotations

import math
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from zankup.db.models import UserSettings

EARTH = 6_371_000.0
JITTER_M = 60.0
MIN_RADIUS_M, MAX_RADIUS_M = 100.0, 5000.0
Point = tuple[float, float]


def zones_of(session: Session, user_id: int) -> list[dict[str, Any]]:
    stored = session.scalar(select(UserSettings.privacy_zones).where(UserSettings.user_id == user_id))
    return [z for z in stored or [] if _valid(z)]


def _valid(zone: dict[str, Any]) -> bool:
    try:
        return (
            -90 <= float(zone["lat"]) <= 90
            and -180 <= float(zone["lon"]) <= 180
            and float(zone["radius_m"]) > 0
        )
    except (KeyError, TypeError, ValueError):
        return False


def distance(a: Point, b: Point) -> float:
    k = math.cos(math.radians((a[0] + b[0]) / 2))
    return EARTH * math.hypot(math.radians(b[1] - a[1]) * k, math.radians(b[0] - a[0]))


def hidden(point: Point, zones: list[dict[str, Any]]) -> bool:
    return any(
        distance(point, (float(z["lat"]), float(z["lon"]))) <= float(z["radius_m"]) + JITTER_M for z in zones
    )


def trim(points: list[Point], zones: list[dict[str, Any]]) -> list[list[Point]]:
    """The route without the points inside any zone, as the stretches between them."""
    stretches: list[list[Point]] = []
    current: list[Point] = []
    for point in points:
        if zones and hidden(point, zones):
            if len(current) > 1:
                stretches.append(current)
            current = []
        else:
            current.append(point)
    if len(current) > 1:
        stretches.append(current)
    return stretches


def mask(
    lat: list[float | None], lon: list[float | None], zones: list[dict[str, Any]]
) -> tuple[list[float | None], list[float | None]]:
    """The position series with every point inside a zone set to None."""
    if not zones:
        return lat, lon
    out_lat: list[float | None] = []
    out_lon: list[float | None] = []
    for a, o in zip(lat, lon, strict=True):
        if a is not None and o is not None and hidden((a, o), zones):
            out_lat.append(None)
            out_lon.append(None)
        else:
            out_lat.append(a)
            out_lon.append(o)
    return out_lat, out_lon


def clean_zones(zones: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Validated zones as stored: id, name, lat, lon, radius_m."""
    out = []
    for index, zone in enumerate(zones[:20]):
        if not _valid(zone):
            continue
        out.append(
            {
                "id": str(zone.get("id") or f"zone-{index + 1}")[:40],
                "name": str(zone.get("name") or "")[:120],
                "lat": round(float(zone["lat"]), 6),
                "lon": round(float(zone["lon"]), 6),
                "radius_m": round(min(max(float(zone["radius_m"]), MIN_RADIUS_M), MAX_RADIUS_M)),
            }
        )
    return out
