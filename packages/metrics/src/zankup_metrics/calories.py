"""Calorie estimate (OS-324), for activities whose device did not give one (the device always wins).

With HR, Keytel et al. (2005), energy expenditure from HR, weight (kg), age (years) and sex, in
kJ/min, converted to kcal:
- men:   (-55.0969 + 0.6309·HR + 0.1988·W + 0.2017·A) / 4.184
- women: (-20.4022 + 0.4472·HR - 0.1263·W + 0.074·A) / 4.184
(the average of both when sex is unknown). Without HR, METs x weight x hours, with a MET per sport
from the Compendium of Physical Activities.
"""

from __future__ import annotations

METS = {"run": 9.8, "ride": 7.5, "walk": 3.5, "swim": 8.0, "row": 7.0, "strength": 5.0, "other": 5.0}


def keytel(avg_hr: float, minutes: float, weight_kg: float, age: float, sex: str | None) -> float:
    male = (-55.0969 + 0.6309 * avg_hr + 0.1988 * weight_kg + 0.2017 * age) / 4.184
    female = (-20.4022 + 0.4472 * avg_hr - 0.1263 * weight_kg + 0.074 * age) / 4.184
    per_minute = male if sex == "male" else female if sex == "female" else (male + female) / 2
    return max(0.0, per_minute * minutes)


def mets(sport: str, minutes: float, weight_kg: float) -> float:
    return METS.get(sport, METS["other"]) * weight_kg * minutes / 60


def calories(
    sport: str,
    minutes: float,
    avg_hr: float | None,
    weight_kg: float | None,
    age: float | None,
    sex: str | None,
) -> float | None:
    """Keytel with HR, weight and age; METs with only the weight; None without the weight."""
    if weight_kg is None or minutes <= 0:
        return None
    if avg_hr and age:
        return keytel(avg_hr, minutes, weight_kg, age, sex)
    return mets(sport, minutes, weight_kg)
