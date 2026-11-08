"""Helpers shared by the metrics: clean (time, value) pairs and linear interpolation."""

from collections.abc import Sequence


def pairs(t: Sequence[float], values: Sequence[float | None]) -> list[tuple[float, float]]:
    """(time, value) for samples that have a value, in time order."""
    return [(ti, float(vi)) for ti, vi in zip(t, values, strict=True) if vi is not None]


def time_at(points: Sequence[tuple[float, float]], index: int, target: float) -> float:
    """Time at which the monotonic value series reaches `target`, interpolating between index-1 and index."""
    t1, v1 = points[index]
    if index == 0:
        return t1
    t0, v0 = points[index - 1]
    if v1 <= v0:
        return t1
    return t0 + (t1 - t0) * (target - v0) / (v1 - v0)
