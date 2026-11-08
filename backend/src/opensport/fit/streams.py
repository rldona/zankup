"""Compact storage for activity streams and the simplified route used by thumbnails (OS-106)."""

from __future__ import annotations

import gzip
import json
import math
from typing import Any

from opensport.fit.parser import Streams

ENCODING = "json+gzip"
# Decimals kept per series: enough for the metrics, much smaller than raw floats.
PRECISION = {"t": 1, "lat": 6, "lon": 6, "dist": 1, "alt": 1, "cad": 1, "speed": 2, "temp": 1}


def _round(values: list[Any], decimals: int | None) -> list[Any]:
    if decimals is None:
        return values
    return [None if v is None else round(v, decimals) for v in values]


def encode_streams(streams: Streams) -> tuple[bytes, list[str]]:
    """Gzipped JSON with one array per series that has data. Returns (data, series names)."""
    names = streams.present()
    payload = {name: _round(getattr(streams, name), PRECISION.get(name)) for name in names}
    raw = json.dumps(payload, separators=(",", ":")).encode()
    return gzip.compress(raw, compresslevel=9, mtime=0), names


def decode_streams(data: bytes) -> dict[str, list[Any]]:
    decoded: dict[str, list[Any]] = json.loads(gzip.decompress(data))
    return decoded


# --- simplified route ------------------------------------------------------------------------------


def _perpendicular(p: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
    """Distance from p to segment ab in a local flat projection (fine for simplification)."""
    k = math.cos(math.radians(a[0]))
    px, py, ax, ay, bx, by = p[1] * k, p[0], a[1] * k, a[0], b[1] * k, b[0]
    dx, dy = bx - ax, by - ay
    if dx == dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplify(points: list[tuple[float, float]], tolerance_deg: float) -> list[tuple[float, float]]:
    """Ramer-Douglas-Peucker, iterative so long tracks do not hit the recursion limit."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        index, worst = 0, 0.0
        for i in range(first + 1, last):
            d = _perpendicular(points[i], points[first], points[last])
            if d > worst:
                index, worst = i, d
        if worst > tolerance_deg:
            keep[index] = True
            stack += [(first, index), (index, last)]
    return [p for p, k in zip(points, keep, strict=True) if k]


def simplify_to(points: list[tuple[float, float]], max_points: int = 120) -> list[tuple[float, float]]:
    """Simplify with a growing tolerance until the route has at most `max_points` points."""
    tolerance = 0.00002  # about 2 m
    simplified = simplify(points, tolerance)
    while len(simplified) > max_points:
        tolerance *= 1.6
        simplified = simplify(points, tolerance)
    return simplified


def encode_polyline(points: list[tuple[float, float]], precision: int = 5) -> str:
    """Google's encoded polyline format (what map libraries and thumbnails expect)."""
    factor = 10**precision
    out, prev_lat, prev_lon = [], 0, 0
    for lat, lon in points:
        ilat, ilon = round(lat * factor), round(lon * factor)
        for delta in (ilat - prev_lat, ilon - prev_lon):
            value = ~(delta << 1) if delta < 0 else delta << 1
            while value >= 0x20:
                out.append(chr((0x20 | (value & 0x1F)) + 63))
                value >>= 5
            out.append(chr(value + 63))
        prev_lat, prev_lon = ilat, ilon
    return "".join(out)


def decode_polyline(encoded: str, precision: int = 5) -> list[tuple[float, float]]:
    factor, points, index, lat, lon = 10**precision, [], 0, 0, 0
    while index < len(encoded):
        deltas = []
        for _ in range(2):
            shift, result = 0, 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            deltas.append(~(result >> 1) if result & 1 else result >> 1)
        lat, lon = lat + deltas[0], lon + deltas[1]
        points.append((lat / factor, lon / factor))
    return points


def route_polyline(streams: Streams, max_points: int = 120) -> str | None:
    points = [
        (a, o) for a, o in zip(streams.lat, streams.lon, strict=True) if a is not None and o is not None
    ]
    return encode_polyline(simplify_to(points, max_points)) if len(points) >= 2 else None
