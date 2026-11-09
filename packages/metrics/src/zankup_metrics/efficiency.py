"""Aerobic efficiency and decoupling (OS-317, OS-312).

- Efficiency factor: average speed (m/min) over average HR. Rising over months at equal effort means
  better aerobic fitness.
- Decoupling (Pa:HR): how much the speed-to-HR ratio drops from the first half of an activity to the
  second, in %. Under 5 % on a long steady effort suggests a solid aerobic base.
"""

from __future__ import annotations

from collections.abc import Sequence


def efficiency(distance_m: float, moving_s: float, avg_hr: float) -> float | None:
    if moving_s <= 0 or avg_hr <= 0 or distance_m <= 0:
        return None
    return (distance_m / (moving_s / 60)) / avg_hr


def decoupling(t: Sequence[float], dist: Sequence[float | None], hr: Sequence[float | None]) -> float | None:
    """Percent drop of speed/HR from the first half (by time) to the second. None if too short."""
    samples = [(ti, d, h) for ti, d, h in zip(t, dist, hr, strict=True) if d is not None and h]
    if len(samples) < 20 or samples[-1][0] - samples[0][0] < 1200:
        return None
    middle = samples[0][0] + (samples[-1][0] - samples[0][0]) / 2
    first = [s for s in samples if s[0] <= middle]
    second = [s for s in samples if s[0] > middle]

    def ratio(part: list[tuple[float, float, float]]) -> float | None:
        span = part[-1][0] - part[0][0]
        if span <= 0:
            return None
        speed = (part[-1][1] - part[0][1]) / span
        hr_avg = sum(s[2] for s in part) / len(part)
        return speed / hr_avg

    a, b = ratio(first), ratio(second)
    if not a or b is None:
        return None
    return (a - b) / a * 100
