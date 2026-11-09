"""Performance estimates (OS-307, OS-316). Each returns its value with the method used, so the app
can explain it.

- FTP: 95 % of the best 20-minute power (Allen & Coggan). Without a 20-minute effort, the critical
  power from the 3- and 12-minute bests (two-parameter model: P = CP + W'/t).
- Critical speed (threshold pace for runners): the same two-parameter model on distance,
  d = CS·t + D', fitted to the best efforts between 3 and 30 minutes.
- LTHR: average HR of the best 20-minute HR effort x 0.95, or of a 60-minute one as it is.
- Observed max HR: the highest max HR recorded, ignoring impossible values (over 230 bpm).
- VO₂max as VDOT (Daniels & Gilbert): from a race time and distance.
- Race times: Riegel, T₂ = T₁ · (D₂ / D₁)^1.06, from the best recent effort.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class Estimate:
    value: float
    method: str


def ftp(power_curve: dict[int, float]) -> Estimate | None:
    if 1200 in power_curve:
        return Estimate(0.95 * power_curve[1200], "95% of best 20 min power")
    if 180 in power_curve and 720 in power_curve:
        cp = (power_curve[720] * 720 - power_curve[180] * 180) / (720 - 180)
        return Estimate(cp, "critical power from best 3 and 12 min")
    return None


def critical_speed(efforts: Sequence[tuple[float, float]]) -> Estimate | None:
    """From (distance m, time s) efforts: least-squares fit of d = CS·t + D' over 3-30 min efforts."""
    points = [(t, d) for d, t in efforts if 180 <= t <= 1800]
    if len(points) < 2:
        return None
    n = len(points)
    mt = sum(t for t, _ in points) / n
    md = sum(d for _, d in points) / n
    var = sum((t - mt) ** 2 for t, _ in points)
    if var == 0:
        return None
    cs = sum((t - mt) * (d - md) for t, d in points) / var
    return Estimate(cs, f"critical speed from {n} best efforts of 3-30 min") if cs > 0 else None


def lthr(hr_curve: dict[int, float]) -> Estimate | None:
    if 3600 in hr_curve:
        return Estimate(hr_curve[3600], "average HR of best 60 min")
    if 1200 in hr_curve:
        return Estimate(0.95 * hr_curve[1200], "95% of average HR of best 20 min")
    return None


def max_hr(observed: Sequence[float]) -> Estimate | None:
    valid = [h for h in observed if 100 <= h <= 230]
    return Estimate(max(valid), "highest HR recorded") if valid else None


def vdot(distance_m: float, time_s: float) -> float:
    """Daniels' VDOT: oxygen cost of the speed over the fraction of VO₂max sustainable that long."""
    minutes = time_s / 60
    v = distance_m / minutes  # m/min
    cost = -4.6 + 0.182258 * v + 0.000104 * v * v
    fraction = 0.8 + 0.1894393 * math.exp(-0.012778 * minutes) + 0.2989558 * math.exp(-0.1932605 * minutes)
    return float(cost / fraction)


def riegel(distance_m: float, time_s: float, target_m: float, exponent: float = 1.06) -> float:
    return float(time_s * (target_m / distance_m) ** exponent)


RACES = {"5k": 5000.0, "10k": 10000.0, "half_marathon": 21097.5, "marathon": 42195.0}


def predictions(efforts: Sequence[tuple[float, float]]) -> dict[str, Estimate]:
    """Race times from the effort with the best VDOT among those of at least 3 km (shorter ones
    overestimate endurance)."""
    usable = [(d, t) for d, t in efforts if d >= 3000 and t > 0]
    if not usable:
        return {}
    d, t = max(usable, key=lambda e: vdot(*e))
    label = f"Riegel from your best {d / 1000:g} km"
    return {key: Estimate(riegel(d, t, target), label) for key, target in RACES.items()}
