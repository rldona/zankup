"""Relative effort and training load (OS-302, OS-303).

TRIMP (Banister, 1991): for each minute, the HR reserve fraction x = (HR - rest) / (max - rest)
weighted by y·e^(b·x), with y = 0.64 and b = 1.92 for men, 0.86 and 1.67 for women (the average of
both when sex is unknown). It grows exponentially with intensity: an hour easy scores far less than
an hour hard.

Fitness (CTL), fatigue (ATL) and form (TSB), Banister's impulse-response model as popularised by
TrainingPeaks: exponentially weighted averages of daily load with time constants of 42 and 7 days.
TSB is yesterday's CTL minus yesterday's ATL: today's freshness before today's training.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta

COEFFICIENTS = {"male": (0.64, 1.92), "female": (0.86, 1.67)}
CTL_DAYS = 42
ATL_DAYS = 7


def trimp(
    t: Sequence[float],
    hr: Sequence[float | None],
    hr_max: float,
    hr_rest: float,
    sex: str | None = None,
    max_gap_s: float = 30,
) -> float:
    """Banister TRIMP of an activity from its HR series (bpm) and times (s)."""
    if hr_max <= hr_rest:
        raise ValueError("Max HR must be above resting HR")
    if sex in COEFFICIENTS:
        y, b = COEFFICIENTS[sex]
    else:
        y = (COEFFICIENTS["male"][0] + COEFFICIENTS["female"][0]) / 2
        b = (COEFFICIENTS["male"][1] + COEFFICIENTS["female"][1]) / 2
    total = 0.0
    for i in range(len(t) - 1):
        value = hr[i]
        dt = t[i + 1] - t[i]
        if value is None or dt <= 0 or dt > max_gap_s:
            continue
        x = min(1.0, max(0.0, (value - hr_rest) / (hr_max - hr_rest)))
        total += (dt / 60) * x * y * math.exp(b * x)
    return total


@dataclass(frozen=True)
class DailyLoad:
    day: date
    load: float
    ctl: float
    atl: float
    tsb: float


def fitness(loads: dict[date, float], until: date, start: date | None = None) -> list[DailyLoad]:
    """Day by day from the first load (or `start`) to `until`: load, fitness, fatigue and form."""
    if not loads and start is None:
        return []
    day = start or min(loads)
    ctl = atl = 0.0
    out = []
    while day <= until:
        load = loads.get(day, 0.0)
        tsb = ctl - atl
        ctl += (load - ctl) / CTL_DAYS
        atl += (load - atl) / ATL_DAYS
        out.append(DailyLoad(day, load, ctl, atl, tsb))
        day += timedelta(days=1)
    return out


def ramp(series: Sequence[DailyLoad]) -> float | None:
    """Change of fitness over the last 7 days (CTL points per week): above ~8 is a risky ramp."""
    if len(series) < 8:
        return None
    return series[-1].ctl - series[-8].ctl
