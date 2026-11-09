"""Training zones (OS-301): HR, power and pace, with the lower bound of each zone.

HR, three models (five zones):
- `max`: share of max HR, 50/60/70/80/90 % (the prototype's and many watches' default).
- `reserve`: Karvonen, rest + share x (max - rest) at 50/60/70/80/90 %.
- `lthr`: Friel's run zones over lactate threshold HR: 0/85/90/95/100 % (Z5 starts at LTHR).

Power, Coggan's seven zones over FTP: 0/55/75/90/105/120/150 %.
Pace, five zones over threshold speed: 0/78/88/95/100 % (speed, so faster is higher).
"""

from __future__ import annotations

from collections.abc import Sequence

HR_SHARES = (0.5, 0.6, 0.7, 0.8, 0.9)
LTHR_SHARES = (0.0, 0.85, 0.90, 0.95, 1.0)
POWER_SHARES = (0.0, 0.55, 0.75, 0.90, 1.05, 1.20, 1.50)
PACE_SHARES = (0.0, 0.78, 0.88, 0.95, 1.0)


def hr_zones(
    method: str, hr_max: float, hr_rest: float | None = None, lthr: float | None = None
) -> list[float]:
    """Lower bound (bpm) of each of the five HR zones for a model."""
    if method == "reserve":
        if hr_rest is None:
            raise ValueError("The reserve model needs resting HR")
        return [hr_rest + s * (hr_max - hr_rest) for s in HR_SHARES]
    if method == "lthr":
        if lthr is None:
            raise ValueError("The LTHR model needs threshold HR")
        return [s * lthr for s in LTHR_SHARES]
    return [s * hr_max for s in HR_SHARES]


def power_zones(ftp: float) -> list[float]:
    return [s * ftp for s in POWER_SHARES]


def pace_zones(threshold_speed: float) -> list[float]:
    """Lower bound of each zone as a speed in m/s (Z1 starts at 0)."""
    return [s * threshold_speed for s in PACE_SHARES]


def time_in_zones(
    t: Sequence[float], values: Sequence[float | None], bounds: Sequence[float], max_gap_s: float = 30
) -> list[float]:
    """Seconds in each zone. Each sample counts until the next one; gaps over `max_gap_s` (a paused
    watch) count nothing. Below the first bound counts nothing (unless the first bound is 0)."""
    zones = [0.0] * len(bounds)
    for i in range(len(t) - 1):
        v = values[i]
        dt = t[i + 1] - t[i]
        if v is None or dt <= 0 or dt > max_gap_s:
            continue
        for z in range(len(bounds) - 1, -1, -1):
            if v >= bounds[z]:
                zones[z] += dt
                break
    return zones
