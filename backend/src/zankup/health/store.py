"""Saving health data (OS-601): one row per sleep and per day for each source, upserted by the
source's own id, so syncing the same range again changes nothing.

Every source converts its data to `SleepIn` and `DayIn` first; this module computes the stage totals,
the night the sleep belongs to and Zankup's sleep score, the same for every source.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from zankup.db.models import DailyHealth, SleepSession

Stage = Literal["awake", "light", "deep", "rem"]
STAGES: tuple[Stage, ...] = ("awake", "light", "deep", "rem")


@dataclass
class SleepIn:
    external_id: str
    start: datetime
    end: datetime
    utc_offset_s: int | None = None
    stages: list[tuple[datetime, datetime, Stage]] | None = None
    # Totals, when the source gives them and there are no stages (or to trust its own totals).
    asleep_s: int | None = None
    awake_s: int | None = None
    light_s: int | None = None
    deep_s: int | None = None
    rem_s: int | None = None
    nap: bool = False
    origin: str | None = None


@dataclass
class DayIn:
    day: date
    external_id: str
    resting_hr: float | None = None
    hrv_ms: float | None = None
    spo2: float | None = None
    respiration: float | None = None
    steps: int | None = None
    wear_s: int | None = None


def _clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


SCORE_WEIGHTS = {"duration": 0.5, "efficiency": 0.2, "deep": 0.15, "rem": 0.15}


def sleep_score(asleep_s: int | None, in_bed_s: int, deep_s: int | None, rem_s: int | None) -> int | None:
    """Zankup's sleep score, 0 to 100, computed the same way for every source.

    Close to Fitbit's and Garmin's, which weigh duration most and do not let one stage make up for
    another (Google Health's API does not give out its own score):
    - Duration (half): 4 h or less is 0, 8 h or more is full marks.
    - Efficiency (a fifth): time asleep over time in bed, from 70 % (0) to 95 % (full).
    - Deep sleep and REM (15 % each), each against its usual share of the night: 20 % deep and
      22 % REM give full marks. Without stages, duration and efficiency share the whole score.
    """
    if not asleep_s or in_bed_s <= 0:
        return None
    parts = {
        "duration": _clamp((asleep_s / 3600 - 4) / 4),
        "efficiency": _clamp((asleep_s / in_bed_s - 0.70) / 0.25),
    }
    if deep_s is not None and rem_s is not None and (deep_s or rem_s):
        parts["deep"] = _clamp(deep_s / asleep_s / 0.20)
        parts["rem"] = _clamp(rem_s / asleep_s / 0.22)
    total = sum(SCORE_WEIGHTS[k] for k in parts)
    return round(100 * sum(v * SCORE_WEIGHTS[k] for k, v in parts.items()) / total)


def night_of(end: datetime, utc_offset_s: int | None) -> date:
    """The local date the person woke up on."""
    return (end + timedelta(seconds=utc_offset_s or 0)).date()


def save_sleep(session: Session, user_id: int, source: str, sleep: SleepIn) -> None:
    totals: dict[str, int | None] = {
        "awake": sleep.awake_s,
        "light": sleep.light_s,
        "deep": sleep.deep_s,
        "rem": sleep.rem_s,
    }
    stages: list[list[int | str]] | None = None
    if sleep.stages:
        ordered = sorted(sleep.stages, key=lambda s: s[0])
        sums = dict.fromkeys(STAGES, 0)
        stages = []
        for start, end, stage in ordered:
            seconds = int((end - start).total_seconds())
            if seconds <= 0:
                continue
            sums[stage] += seconds
            stages.append([int((start - sleep.start).total_seconds()), seconds, stage])
        totals = {k: totals[k] if totals[k] is not None else v for k, v in sums.items()}
    asleep = sleep.asleep_s
    if asleep is None and any(totals[k] is not None for k in ("light", "deep", "rem")):
        asleep = sum(totals[k] or 0 for k in ("light", "deep", "rem"))
    in_bed = int((sleep.end - sleep.start).total_seconds())
    if asleep is None and totals["awake"] is not None:
        asleep = max(in_bed - totals["awake"], 0)
    has_stages = bool(totals["deep"] or totals["rem"])
    values = {
        "user_id": user_id,
        "source": source,
        "external_id": sleep.external_id[:128],
        "origin": (sleep.origin or None) and sleep.origin[:120],
        "day": night_of(sleep.end, sleep.utc_offset_s),
        "start_utc": sleep.start,
        "end_utc": sleep.end,
        "utc_offset_s": sleep.utc_offset_s,
        "nap": sleep.nap,
        "asleep_s": asleep,
        "awake_s": totals["awake"],
        "light_s": totals["light"] if has_stages else None,
        "deep_s": totals["deep"] if has_stages else None,
        "rem_s": totals["rem"] if has_stages else None,
        "score": sleep_score(
            asleep, in_bed, totals["deep"] if has_stages else None, totals["rem"] if has_stages else None
        ),
        "stages": stages,
    }
    statement = insert(SleepSession).values(**values)
    update = {k: statement.excluded[k] for k in values if k not in ("user_id", "source", "external_id")}
    session.execute(
        statement.on_conflict_do_update(
            index_elements=["user_id", "source", "external_id"], set_={**update, "updated_at": func.now()}
        )
    )


FIELDS = ("resting_hr", "hrv_ms", "spo2", "respiration", "steps", "wear_s")


def save_day(session: Session, user_id: int, source: str, day: DayIn) -> None:
    """Upsert one day; a field the source did not send this time keeps its stored value."""
    values = {f: getattr(day, f) for f in FIELDS}
    if all(v is None for v in values.values()):
        return
    row = {
        "user_id": user_id,
        "source": source,
        "day": day.day,
        "external_id": day.external_id[:128],
        **values,
    }
    statement = insert(DailyHealth).values(**row)
    table = DailyHealth.__table__.c
    update = {f: func.coalesce(statement.excluded[f], table[f]) for f in FIELDS}
    session.execute(
        statement.on_conflict_do_update(
            index_elements=["user_id", "source", "day"],
            set_={**update, "external_id": statement.excluded.external_id, "updated_at": func.now()},
        )
    )
