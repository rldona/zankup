"""Splits: time, pace, elevation change and heart rate for every kilometre (or mile).

Split boundaries are where the device's cumulative distance crosses each multiple of the split length,
with times interpolated between samples. The last split is partial and keeps its real distance.
"""

from __future__ import annotations

import itertools
from collections.abc import Sequence
from dataclasses import dataclass

from zankup_metrics._series import pairs, time_at


@dataclass(frozen=True)
class Split:
    index: int
    distance_m: float
    time_s: float
    elevation_change_m: float | None
    avg_hr: float | None

    @property
    def pace_s_per_km(self) -> float:
        return self.time_s / (self.distance_m / 1000)


def _value_at(points: Sequence[tuple[float, float]], when: float) -> float | None:
    """Value of a (time, value) series at time `when`, interpolated."""
    if not points:
        return None
    if when <= points[0][0]:
        return points[0][1]
    for (t0, v0), (t1, v1) in itertools.pairwise(points):
        if t0 <= when <= t1:
            return v0 if t1 == t0 else v0 + (v1 - v0) * (when - t0) / (t1 - t0)
    return points[-1][1]


def _mean_between(points: Sequence[tuple[float, float]], start: float, end: float) -> float | None:
    """Time-weighted mean of a series between two times (each sample holds until the next)."""
    total = weight = 0.0
    for (t0, v0), (t1, _) in itertools.pairwise(points):
        a, b = max(t0, start), min(t1, end)
        if b > a:
            total, weight = total + v0 * (b - a), weight + (b - a)
    return total / weight if weight else None


def splits(
    t: Sequence[float],
    dist: Sequence[float | None],
    alt: Sequence[float | None] | None = None,
    hr: Sequence[int | None] | None = None,
    split_m: float = 1000.0,
    min_last_m: float = 50.0,
) -> list[Split]:
    """Splits of `split_m` metres; a final partial split shorter than `min_last_m` is dropped."""
    points = pairs(t, dist)
    if len(points) < 2:
        return []
    altitude = pairs(t, alt) if alt is not None else []
    heart = pairs(t, hr) if hr is not None else []
    start_d, end_d = points[0][1], points[-1][1]
    boundaries: list[tuple[float, float]] = [(points[0][0], start_d)]
    index, k = 0, 1
    while start_d + k * split_m <= end_d:
        target = start_d + k * split_m
        while points[index][1] < target:
            index += 1
        boundaries.append((time_at(points, index, target), target))
        k += 1
    if end_d - boundaries[-1][1] >= min_last_m:
        boundaries.append((points[-1][0], end_d))

    result = []
    for i, ((t0, d0), (t1, d1)) in enumerate(itertools.pairwise(boundaries), start=1):
        a0, a1 = _value_at(altitude, t0), _value_at(altitude, t1)
        result.append(
            Split(
                index=i,
                distance_m=d1 - d0,
                time_s=t1 - t0,
                elevation_change_m=None if a0 is None or a1 is None else a1 - a0,
                avg_hr=_mean_between(heart, t0, t1),
            )
        )
    return result
