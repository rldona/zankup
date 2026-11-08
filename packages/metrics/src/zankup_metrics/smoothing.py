"""Smoothed speed and pace, for charts and for the maximum speed of an activity.

A centred moving average over a time window (not a sample count), so it behaves the same at 1 Hz and
with smart recording.
"""

from __future__ import annotations

from collections.abc import Sequence


def rolling_mean(t: Sequence[float], values: Sequence[float | None], window_s: float) -> list[float | None]:
    """Mean of the values within ±window_s/2 of each sample (None where a sample has no value)."""
    half = window_s / 2
    out: list[float | None] = []
    lo = hi = 0
    total, count = 0.0, 0
    for i, ti in enumerate(t):
        while hi < len(t) and t[hi] <= ti + half:
            if values[hi] is not None:
                total, count = total + float(values[hi]), count + 1  # type: ignore[arg-type]
            hi += 1
        while t[lo] < ti - half:
            if values[lo] is not None:
                total, count = total - float(values[lo]), count - 1  # type: ignore[arg-type]
            lo += 1
        out.append(total / count if values[i] is not None and count else None)
    return out


def pace_s_per_km(speed: float | None, min_speed: float = 0.3) -> float | None:
    """Pace in seconds per km, or None when standing still."""
    return 1000 / speed if speed is not None and speed > min_speed else None
