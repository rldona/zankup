"""One value per day and metric when several sources measured it (OS-605), and readiness (OS-606).

Nothing is merged or deleted: every source keeps its rows, and this module chooses at read time, so a
change of preference applies to the whole history at once.

- With an order set for a metric (Settings → Health), the first source in it that has a value wins.
- Otherwise, the automatic rules:
  - **sleep**: of that night's main sleeps (naps aside), the one with stages, then the longest;
  - **HRV, SpO₂, respiration** (measured overnight): the source of the chosen sleep, then the one worn
    longest that day;
  - **resting HR and steps**: the source worn longest that day (most hours with heart-rate data), then
    the source of that night's sleep.
  - Activities are not chosen here: Garmin's FIT wins on import (OS-406).

Readiness (0 to 100) combines last night's HRV and resting HR against the person's last 60 days, the
sleep score and the form (TSB, phase 3). Each part is also returned, so the screen can explain it.
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date, timedelta
from statistics import fmean, pstdev

from sqlalchemy import select
from sqlalchemy.orm import Session

from zankup.db.models import (
    HEALTH_METRICS,
    HEALTH_SOURCES,
    DailyHealth,
    DailyLoad,
    SleepSession,
    SourcePriority,
)

FALLBACK = ("google_health", "garmin", "health_connect")
OVERNIGHT = ("hrv", "spo2", "respiration")
COLUMN = {
    "resting_hr": "resting_hr",
    "hrv": "hrv_ms",
    "spo2": "spo2",
    "respiration": "respiration",
    "steps": "steps",
}
BASELINE_DAYS = 60
MIN_BASELINE = 7
WEIGHTS = {"hrv": 0.35, "resting_hr": 0.2, "sleep": 0.25, "form": 0.2}


@dataclass
class Picked:
    value: float
    source: str
    others: list[str] = field(default_factory=list)


@dataclass
class Readiness:
    score: int
    hrv: int | None = None
    resting_hr: int | None = None
    sleep: int | None = None
    form: int | None = None


@dataclass
class Day:
    day: date
    sleep: SleepSession | None = None
    sleep_others: list[str] = field(default_factory=list)
    values: dict[str, Picked] = field(default_factory=dict)
    tsb: float | None = None
    readiness: Readiness | None = None


def priorities(session: Session, user_id: int) -> dict[str, list[str]]:
    rows = session.scalars(select(SourcePriority).where(SourcePriority.user_id == user_id))
    stored = {r.metric: [s for s in r.sources if s in HEALTH_SOURCES] for r in rows}
    return {m: stored.get(m, []) for m in HEALTH_METRICS}


def _rank(order: list[str], source: str) -> int:
    return order.index(source) if source in order else len(order)


def choose_sleep(candidates: Iterable[SleepSession], order: list[str]) -> SleepSession | None:
    main = [s for s in candidates if not s.nap and s.asleep_s]
    if not main:
        return None
    return min(
        main,
        key=lambda s: (
            _rank(order, s.source),
            0 if (s.deep_s or s.rem_s) else 1,
            -(s.asleep_s or 0),
            FALLBACK.index(s.source) if s.source in FALLBACK else 9,
        ),
    )


def choose_value(
    metric: str, rows: list[DailyHealth], order: list[str], night_source: str | None
) -> Picked | None:
    column = COLUMN[metric]
    have = [r for r in rows if getattr(r, column) is not None]
    if not have:
        return None

    def automatic(r: DailyHealth) -> tuple[int, int, int]:
        night = 0 if r.source == night_source else 1
        worn = -(r.wear_s or 0)
        fallback = FALLBACK.index(r.source) if r.source in FALLBACK else 9
        return (night, worn, fallback) if metric in OVERNIGHT else (worn, night, fallback)

    best = min(have, key=lambda r: (_rank(order, r.source), *automatic(r)))
    return Picked(
        value=float(getattr(best, column)),
        source=best.source,
        others=sorted(r.source for r in have if r is not best),
    )


def _z(value: float, history: list[float], floor: float) -> float | None:
    if len(history) < MIN_BASELINE:
        return None
    return (value - fmean(history)) / max(pstdev(history), floor)


def _part(z: float) -> int:
    return round(max(0.0, min(100.0, 50 + 20 * z)))


def readiness(
    hrv: float | None,
    hrv_history: list[float],
    resting: float | None,
    resting_history: list[float],
    sleep_score: int | None,
    tsb: float | None,
) -> Readiness | None:
    parts: dict[str, int] = {}
    if hrv and (z := _z(math.log(hrv), [math.log(v) for v in hrv_history if v > 0], 0.05)) is not None:
        parts["hrv"] = _part(z)
    if resting and (z := _z(resting, resting_history, 1.5)) is not None:
        parts["resting_hr"] = _part(-z)  # lower than usual is better
    if sleep_score is not None:
        parts["sleep"] = sleep_score
    if tsb is not None:
        parts["form"] = round(max(0.0, min(100.0, 60 + 1.5 * tsb)))
    if len(parts) < 2 or not parts.keys() - {"form"}:
        return None
    total = sum(WEIGHTS[k] for k in parts)
    score = round(sum(v * WEIGHTS[k] for k, v in parts.items()) / total)
    return Readiness(score=score, **parts)


def days(session: Session, user_id: int, start: date, end: date) -> list[Day]:
    """Every day in [start, end) that has some health data, oldest first, with readiness."""
    order = priorities(session, user_id)
    first = start - timedelta(days=BASELINE_DAYS)
    nights: dict[date, list[SleepSession]] = defaultdict(list)
    for s in session.scalars(
        select(SleepSession).where(
            SleepSession.user_id == user_id, SleepSession.day >= first, SleepSession.day < end
        )
    ):
        nights[s.day].append(s)
    rows: dict[date, list[DailyHealth]] = defaultdict(list)
    for r in session.scalars(
        select(DailyHealth).where(
            DailyHealth.user_id == user_id, DailyHealth.day >= first, DailyHealth.day < end
        )
    ):
        rows[r.day].append(r)
    form = {
        r.day: r.tsb
        for r in session.scalars(
            select(DailyLoad).where(DailyLoad.user_id == user_id, DailyLoad.day >= start, DailyLoad.day < end)
        )
    }

    out: list[Day] = []
    hrv_seen: list[tuple[date, float]] = []
    rhr_seen: list[tuple[date, float]] = []
    for day in sorted(set(nights) | set(rows)):
        chosen = choose_sleep(nights.get(day, []), order["sleep"])
        result = Day(day=day, sleep=chosen)
        if chosen is not None:
            result.sleep_others = sorted(
                {s.source for s in nights[day] if s is not chosen and not s.nap and s.source != chosen.source}
            )
        for metric in COLUMN:
            picked = choose_value(metric, rows.get(day, []), order[metric], chosen.source if chosen else None)
            if picked is not None:
                result.values[metric] = picked
        if day >= start:
            since = day - timedelta(days=BASELINE_DAYS)
            result.tsb = form.get(day)
            result.readiness = readiness(
                result.values["hrv"].value if "hrv" in result.values else None,
                [v for d, v in hrv_seen if d >= since],
                result.values["resting_hr"].value if "resting_hr" in result.values else None,
                [v for d, v in rhr_seen if d >= since],
                chosen.score if chosen else None,
                result.tsb,
            )
            out.append(result)
        if "hrv" in result.values:
            hrv_seen.append((day, result.values["hrv"].value))
        if "resting_hr" in result.values:
            rhr_seen.append((day, result.values["resting_hr"].value))
    return out
