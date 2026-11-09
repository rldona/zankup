"""Matched routes and segments (OS-309, OS-325), on lat/lon tracks.

Distances use an equirectangular projection around the track (accurate to centimetres over the few
kilometres compared). Two routes match when their starts and ends are within 200 m, their lengths
within 10 %, and, resampled to 50 points along their length, they are on average within 75 m of each
other. A segment is found in a track when the track passes within 30 m of its start and later of its
end, and the stretch between follows the segment (on average within 30 m).
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

EARTH = 6_371_000.0
LatLon = tuple[float, float]


def distance(a: LatLon, b: LatLon) -> float:
    k = math.cos(math.radians((a[0] + b[0]) / 2))
    dx = math.radians(b[1] - a[1]) * k
    dy = math.radians(b[0] - a[0])
    return EARTH * math.hypot(dx, dy)


def length(track: Sequence[LatLon]) -> float:
    return sum(distance(track[i - 1], track[i]) for i in range(1, len(track)))


def resample(track: Sequence[LatLon], points: int = 50) -> list[LatLon]:
    """`points` positions evenly spaced along the track's length."""
    if len(track) < 2:
        return list(track)
    cumulative = [0.0]
    for i in range(1, len(track)):
        cumulative.append(cumulative[-1] + distance(track[i - 1], track[i]))
    total = cumulative[-1]
    out = []
    j = 0
    for k in range(points):
        target = total * k / (points - 1)
        while j < len(track) - 2 and cumulative[j + 1] < target:
            j += 1
        span = cumulative[j + 1] - cumulative[j] or 1.0
        f = (target - cumulative[j]) / span
        a, b = track[j], track[j + 1]
        out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
    return out


def same_route(a: Sequence[LatLon], b: Sequence[LatLon]) -> bool:
    if len(a) < 2 or len(b) < 2:
        return False
    la, lb = length(a), length(b)
    if la < 500 or abs(la - lb) > 0.1 * max(la, lb):
        return False
    if distance(a[0], b[0]) > 200 or distance(a[-1], b[-1]) > 200:
        return False
    ra, rb = resample(a), resample(b)
    return sum(distance(p, q) for p, q in zip(ra, rb, strict=True)) / len(ra) <= 75


@dataclass(frozen=True)
class Match:
    start: int  # index in the track where the segment starts
    end: int  # and where it ends


def find_segment(
    segment: Sequence[LatLon], track: Sequence[LatLon | None], tolerance_m: float = 30
) -> Match | None:
    """The first pass of `track` through `segment`, as indices into the track, or None."""
    if len(segment) < 2:
        return None
    first, last = segment[0], segment[-1]
    seg_len = length(segment)
    n = len(track)
    i = 0
    while i < n:
        p = track[i]
        if p is None or distance(p, first) > tolerance_m:
            i += 1
            continue
        # the closest point to the start in this pass
        best, here = i, p
        while (
            best + 1 < n
            and (step := track[best + 1]) is not None
            and distance(step, first) < distance(here, first)
        ):
            best, here = best + 1, step
        travelled = 0.0
        for j in range(best + 1, n):
            prev, point = track[j - 1], track[j]
            if prev is None or point is None:
                continue
            travelled += distance(prev, point)
            if travelled > seg_len * 1.5:
                break
            if distance(point, last) <= tolerance_m and travelled >= seg_len * 0.8:
                end, at = j, point
                while (
                    end + 1 < n
                    and (step := track[end + 1]) is not None
                    and distance(step, last) < distance(at, last)
                ):
                    end, at = end + 1, step
                stretch = [q for q in track[best : end + 1] if q is not None]
                if _follows(segment, stretch, tolerance_m):
                    return Match(best, end)
                break
        i = best + 1
    return None


def _follows(segment: Sequence[LatLon], stretch: Sequence[LatLon], tolerance_m: float) -> bool:
    if len(stretch) < 2:
        return False
    rs = resample(segment, 30)
    rt = resample(stretch, 30)
    return sum(distance(p, q) for p, q in zip(rs, rt, strict=True)) / len(rs) <= tolerance_m
