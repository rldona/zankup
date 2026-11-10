"""Sleep, HRV, resting HR and steps from the Garmin Connect Personal API (OS-602).

The endpoints are those of Garmin's official library (docs/findings.md). Per day: the night's sleep
(`dailySleep`, with SpO₂ and respiration averages) and the heart rate (`dailyHeartRate`: resting HR,
and the samples, whose count gives the hours the watch was worn). For the whole range: HRV (204 when
the watch does not measure it) and steps.

The days already seen are kept in the Garmin source's cursor (`health`); each run fetches again the
last two days, since Garmin finishes a night's numbers in the morning.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from itertools import pairwise
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from zankup.db.models import Source
from zankup.health.store import DayIn, SleepIn, Stage, save_day, save_sleep
from zankup.sync.garmin import GarminClient

log = logging.getLogger("zankup.health.garmin")

SOURCE = "garmin"
FIRST_DAYS = 30
RANGE_DAYS = 28
REFETCH = timedelta(days=2)
EVERY = timedelta(hours=1)  # scheduled runs; the person can always ask for one
SAMPLE_S = 120.0  # dailyHeartRate's sampling while the watch is worn
MIN_WEAR = timedelta(hours=4)
# Garmin's sleep levels: 0 deep, 1 light, 2 REM, 3 awake.
LEVELS: dict[int, Stage] = {0: "deep", 1: "light", 2: "rem", 3: "awake"}


def _when(value: Any) -> datetime | None:
    """Garmin gives times as epoch milliseconds or as "2026-11-07T23:00:00.0" (UTC unless local)."""
    if value is None:
        return None
    if isinstance(value, int | float):
        return datetime.fromtimestamp(value / 1000, UTC)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", ""))
    except ValueError:
        return None
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed


def _int(value: Any) -> int | None:
    return int(value) if isinstance(value, int | float) else None


def _float(value: Any) -> float | None:
    return float(value) if isinstance(value, int | float) and value > 0 else None


def parse_sleep(body: dict[str, Any]) -> tuple[SleepIn | None, DayIn | None]:
    """A `dailySleep` answer: the sleep, and the night's SpO₂ and respiration for the day."""
    wrapped = body.get("dailySleepDTO")
    dto: dict[str, Any] = wrapped if isinstance(wrapped, dict) else body
    start, end = _when(dto.get("sleepStartTimestampGMT")), _when(dto.get("sleepEndTimestampGMT"))
    if start is None or end is None or end <= start or not dto.get("calendarDate"):
        return None, None
    local = _when(dto.get("sleepStartTimestampLocal"))
    offset = int((local - start).total_seconds()) if local else None
    stages: list[tuple[datetime, datetime, Stage]] = []
    for level in body.get("sleepLevels") or []:
        a, b = _when(level.get("startGMT")), _when(level.get("endGMT"))
        stage = LEVELS.get(int(level.get("activityLevel", -1)))
        if a and b and stage:
            stages.append((a, b, stage))
    sleep = SleepIn(
        external_id=str(dto.get("id") or dto["calendarDate"]),
        start=start,
        end=end,
        utc_offset_s=offset,
        stages=stages or None,
        asleep_s=_int(dto.get("sleepTimeSeconds")),
        awake_s=_int(dto.get("awakeSleepSeconds")),
        light_s=_int(dto.get("lightSleepSeconds")),
        deep_s=_int(dto.get("deepSleepSeconds")),
        rem_s=_int(dto.get("remSleepSeconds")),
    )
    day = DayIn(
        day=date.fromisoformat(dto["calendarDate"]),
        external_id=f"day:{dto['calendarDate']}",
        spo2=_float(dto.get("averageSpO2Value")),
        respiration=_float(dto.get("averageRespirationValue")),
    )
    return sleep, day


def parse_heart_rate(body: dict[str, Any]) -> DayIn | None:
    """A `dailyHeartRate` answer: resting HR, and how long the watch measured.

    Garmin lists only the samples it has (one every two minutes while worn), so the time worn is the
    count by the usual gap between them, never more than two minutes. A resting HR from less than
    MIN_WEAR of data is Garmin's guess from a few readings (often during exercise) and is left out.
    """
    if not body.get("calendarDate"):
        return None
    times = sorted(
        s[0] for s in body.get("heartRateValues") or [] if isinstance(s, list) and len(s) > 1 and s[1]
    )
    wear = None
    if len(times) > 1:
        gaps = sorted(b - a for a, b in pairwise(times) if b > a)
        interval = min(gaps[len(gaps) // 2] / 1000, SAMPLE_S) if gaps else SAMPLE_S
        wear = int(len(times) * interval)
    resting = _float(body.get("restingHeartRate"))
    return DayIn(
        day=date.fromisoformat(body["calendarDate"]),
        external_id=f"day:{body['calendarDate']}",
        resting_hr=resting if wear is None or wear >= MIN_WEAR.total_seconds() else None,
        wear_s=wear,
    )


def parse_hrv(body: Any) -> list[DayIn]:
    """The HRV range answer: last night's average RMSSD per day."""
    items = body.get("hrvSummaries") if isinstance(body, dict) else body
    if isinstance(body, dict) and "hrvSummary" in body:
        items = [body["hrvSummary"]]
    out = []
    for item in items or []:
        value = _float(item.get("lastNightAvg"))
        if item.get("calendarDate") and value:
            out.append(
                DayIn(
                    day=date.fromisoformat(item["calendarDate"]),
                    external_id=f"day:{item['calendarDate']}",
                    hrv_ms=value,
                )
            )
    return out


def parse_steps(body: Any) -> list[DayIn]:
    out = []
    for item in body if isinstance(body, list) else []:
        steps = _int(item.get("totalSteps"))
        if item.get("calendarDate") and steps:
            out.append(
                DayIn(
                    day=date.fromisoformat(item["calendarDate"]),
                    external_id=f"day:{item['calendarDate']}",
                    steps=steps,
                )
            )
    return out


def _get(client: GarminClient, path: str, params: dict[str, Any] | None = None) -> Any:
    response = client._authorised("GET", path, {"Accept": "application/json"}, params=params)
    if response.status_code == 204 or not response.content:
        return None
    return response.json()


def _cursor(session: Session, user_id: int) -> tuple[Source | None, dict[str, Any]]:
    source = session.scalar(select(Source).where(Source.user_id == user_id, Source.kind == SOURCE))
    return source, dict(((source.sync_cursor or {}) if source else {}).get("health") or {})


def due(session: Session, user_id: int, now: datetime) -> bool:
    _, health = _cursor(session, user_id)
    at = health.get("at")
    return at is None or now - datetime.fromisoformat(at) >= EVERY - timedelta(minutes=5)


def sync_health(
    sessions: sessionmaker[Session],
    client: GarminClient,
    user_id: int,
    *,
    since: date | None = None,
    pause_s: float = 0.3,
    sleep: Callable[[float], None] = time.sleep,
    today: date | None = None,
) -> int:
    """Fetch and save the days from `since` (or the cursor) to today. Returns the days fetched."""
    today = today or datetime.now(UTC).date()
    with sessions() as session:
        _, health = _cursor(session, user_id)
    if since is None:
        until = health.get("until")
        since = date.fromisoformat(until) - REFETCH if until else today - timedelta(days=FIRST_DAYS)
    days = [since + timedelta(days=i) for i in range((today - since).days + 1)]
    if not days:
        return 0

    # The ranged figures go in windows of four weeks: a year's history in one request is more than
    # Garmin answers.
    ranged: list[DayIn] = []
    start = since
    while start <= today:
        end = min(start + timedelta(days=RANGE_DAYS - 1), today)
        for path, parse in (
            (f"/hrv-service/hrv/daily/{start}/{end}", parse_hrv),
            (f"/usersummary-service/stats/steps/daily/{start}/{end}", parse_steps),
        ):
            ranged += parse(_get(client, path))
        start = end + timedelta(days=1)
    with sessions.begin() as session:
        for each in ranged:
            save_day(session, user_id, SOURCE, each)

    for index, day in enumerate(days):
        if index:
            sleep(pause_s)
        night, overnight = parse_sleep(
            _get(client, "/sleep-service/sleep/dailySleep", {"date": str(day)}) or {}
        )
        heart = parse_heart_rate(
            _get(client, "/wellness-service/wellness/dailyHeartRate", {"date": str(day)}) or {}
        )
        with sessions.begin() as session:
            if night is not None:
                save_sleep(session, user_id, SOURCE, night)
            for item in [overnight, heart]:
                if item is not None:
                    save_day(session, user_id, SOURCE, item)

    with sessions.begin() as session:
        source, health = _cursor(session, user_id)
        if source is None:
            source = Source(user_id=user_id, kind=SOURCE)
            session.add(source)
        until = max(date.fromisoformat(health["until"]), today) if health.get("until") else today
        source.sync_cursor = {
            **(source.sync_cursor or {}),
            "health": {"until": until.isoformat(), "at": datetime.now(UTC).isoformat()},
        }
    log.info("Garmin health synced", extra={"user_id": user_id, "days": len(days)})
    return len(days)
