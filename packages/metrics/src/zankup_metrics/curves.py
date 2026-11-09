"""Best-effort curves (OS-306, OS-315): the best average of a series over each duration.

The series is resampled to one value per second (a sample holds until the next one; gaps over 30 s
count as zero for power and as stopped for distance), then a sliding window over cumulative sums
gives the best mean for each duration in O(n) per duration.

- Power: best average watts for 5 s … 2 h (the "power curve").
- Speed: best distance covered in each duration, as m/s (the pace curve).
- HR: best average HR held for each duration.
"""

from __future__ import annotations

from collections.abc import Sequence

DURATIONS = (5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600, 5400, 7200)


def resample(t: Sequence[float], values: Sequence[float | None], max_gap_s: float = 30) -> list[float | None]:
    """One value per whole second from the start; a gap longer than `max_gap_s` gives None."""
    if not t:
        return []
    start = t[0]
    length = int(t[-1] - start) + 1
    out: list[float | None] = [None] * length
    j = 0
    for second in range(length):
        now = start + second
        while j + 1 < len(t) and t[j + 1] <= now:
            j += 1
        nxt = t[j + 1] if j + 1 < len(t) else t[j]
        if values[j] is not None and (nxt - t[j] <= max_gap_s or now == t[j]):
            out[second] = values[j]
    return out


def mean_max(series: Sequence[float | None], durations: Sequence[int] = DURATIONS) -> dict[int, float]:
    """Best mean of each duration (seconds) over a 1 Hz series; missing seconds count as zero."""
    cumulative = [0.0]
    for v in series:
        cumulative.append(cumulative[-1] + (v or 0.0))
    best: dict[int, float] = {}
    n = len(series)
    for d in durations:
        if d > n:
            continue
        best[d] = max(cumulative[i + d] - cumulative[i] for i in range(n - d + 1)) / d
    return best


def power_curve(t: Sequence[float], power: Sequence[float | None]) -> dict[int, float]:
    return mean_max(resample(t, power))


def hr_curve(t: Sequence[float], hr: Sequence[float | None]) -> dict[int, float]:
    return mean_max(resample(t, hr))


def speed_curve(t: Sequence[float], dist: Sequence[float | None]) -> dict[int, float]:
    """Best speed (m/s) held for each duration, from cumulative distance."""
    per_second = resample(t, dist)
    steps: list[float | None] = []
    last: float | None = None
    for d in per_second:
        steps.append(None if d is None or last is None else max(0.0, d - last))
        if d is not None:
            last = d
    return mean_max(steps)


def combine(curves: Sequence[dict[int, float]]) -> dict[int, float]:
    """The best of several curves at each duration (a period's curve from its activities')."""
    out: dict[int, float] = {}
    for curve in curves:
        for d, v in curve.items():
            if v > out.get(d, float("-inf")):
                out[d] = v
    return out
