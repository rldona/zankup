"""Moving time: the time spent above a speed threshold.

Each interval between two samples counts as moving when the speed at its end is at least
`threshold` m/s. Intervals longer than `max_gap_s` (a pause, or the watch losing samples) do not count.
On the fixture run this gives 2238 s against Garmin's 2237 s.
"""

from __future__ import annotations

from collections.abc import Sequence

DEFAULT_THRESHOLD = 0.5  # m/s, slower than a slow walk
MAX_GAP_S = 30.0


def moving_time(
    t: Sequence[float],
    speed: Sequence[float | None],
    threshold: float = DEFAULT_THRESHOLD,
    max_gap_s: float = MAX_GAP_S,
) -> float | None:
    """Seconds in motion, or None when there is no speed series."""
    if not any(v is not None for v in speed):
        return None
    total = 0.0
    for i in range(1, len(t)):
        dt, v = t[i] - t[i - 1], speed[i]
        if 0 < dt <= max_gap_s and v is not None and v >= threshold:
            total += dt
    return total
