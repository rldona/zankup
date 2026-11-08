"""This week (OS-217): the header above the feed and the "Now" section of Stats.

Days are the activities' own local days (their stored UTC offset, as in the feed's months), and the
week starts on Monday. The client says which day is today, so "today" is the user's, not the server's.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from zankup.api.profile import streak
from zankup.api.routing import protected_router
from zankup.auth.deps import CurrentUser, DbSession
from zankup.db.models import Activity, BestEffort

router = protected_router(prefix="/api", tags=["profile"])

WEEKS_COMPARED = 12


class DayActivity(BaseModel):
    id: int
    sport: str
    name: str | None


class Day(BaseModel):
    date: date
    activities: list[DayActivity]


class WeekTotals(BaseModel):
    week_start: date
    count: int
    distance_m: float
    moving_s: float
    ascent_m: float


class RecentRecord(BaseModel):
    distance_key: str
    distance_m: float
    time_s: float
    activity_id: int
    date: date


class Week(BaseModel):
    today: date
    days: list[Day] = Field(description="Monday to Sunday of this week (future days are empty)")
    this_week: WeekTotals
    previous: list[WeekTotals] = Field(description=f"The {WEEKS_COMPARED} weeks before, newest first")
    streak_weeks: int
    records: list[RecentRecord] = Field(description="All-time bests set in the last 30 days")


@router.get("/week", operation_id="getWeek")
def week(
    db: DbSession,
    user: CurrentUser,
    today: Annotated[date | None, Query(description="The user's today (YYYY-MM-DD); UTC if missing")] = None,
) -> Week:
    today = today or datetime.now(UTC).date()
    monday = today - timedelta(days=today.weekday())
    first = monday - timedelta(weeks=WEEKS_COMPARED)
    rows = db.execute(
        select(
            Activity.id,
            Activity.sport,
            Activity.name,
            Activity.start_utc,
            Activity.timezone,
            Activity.distance_m,
            Activity.moving_s,
            Activity.duration_s,
            Activity.ascent_m,
        )
        .where(
            Activity.user_id == user.id,
            Activity.start_utc >= datetime.combine(first - timedelta(days=1), datetime.min.time(), UTC),
            Activity.start_utc < datetime.combine(monday + timedelta(days=8), datetime.min.time(), UTC),
        )
        .order_by(Activity.start_utc)
    ).all()

    def local_day(start: datetime, timezone: str | None) -> date:
        sign, hours, minutes = 1, 0, 0
        if timezone and len(timezone) == 6 and timezone[0] in "+-" and timezone[3] == ":":
            sign = -1 if timezone[0] == "-" else 1
            hours, minutes = int(timezone[1:3]), int(timezone[4:6])
        return (start + sign * timedelta(hours=hours, minutes=minutes)).date()

    weeks: dict[date, WeekTotals] = {}
    days = {monday + timedelta(days=i): Day(date=monday + timedelta(days=i), activities=[]) for i in range(7)}
    for r in rows:
        day = local_day(r.start_utc, r.timezone)
        start = day - timedelta(days=day.weekday())
        if not first <= start <= monday:
            continue
        totals = weeks.setdefault(
            start, WeekTotals(week_start=start, count=0, distance_m=0, moving_s=0, ascent_m=0)
        )
        totals.count += 1
        totals.distance_m += r.distance_m or 0
        totals.moving_s += r.moving_s or r.duration_s
        totals.ascent_m += r.ascent_m or 0
        if day in days:
            days[day].activities.append(DayActivity(id=r.id, sport=r.sport, name=r.name))

    def empty(start: date) -> WeekTotals:
        return WeekTotals(week_start=start, count=0, distance_m=0, moving_s=0, ascent_m=0)

    previous = [
        weeks.get(monday - timedelta(weeks=i)) or empty(monday - timedelta(weeks=i))
        for i in range(1, WEEKS_COMPARED + 1)
    ]
    all_weeks = {
        s.date() - timedelta(days=s.weekday())
        for s in db.scalars(
            select(Activity.start_utc).where(
                Activity.user_id == user.id, Activity.start_utc >= datetime.now(UTC) - timedelta(days=3 * 366)
            )
        )
    }

    # All-time bests (lowest time per distance) whose activity is from the last 30 days.
    since = datetime.combine(today - timedelta(days=30), datetime.min.time(), UTC)
    records: list[RecentRecord] = []
    for key in db.scalars(select(BestEffort.distance_key).where(BestEffort.user_id == user.id).distinct()):
        best = db.execute(
            select(BestEffort, Activity.start_utc)
            .join(Activity, Activity.id == BestEffort.activity_id)
            .where(BestEffort.user_id == user.id, BestEffort.distance_key == key)
            .order_by(BestEffort.time_s, Activity.start_utc)
            .limit(1)
        ).first()
        if best and best[1] >= since:
            effort = best[0]
            records.append(
                RecentRecord(
                    distance_key=key,
                    distance_m=effort.distance_m,
                    time_s=effort.time_s,
                    activity_id=effort.activity_id,
                    date=best[1].date(),
                )
            )
    records.sort(key=lambda r: r.distance_m)

    return Week(
        today=today,
        days=list(days.values()),
        this_week=weeks.get(monday) or empty(monday),
        previous=previous,
        streak_weeks=streak(all_weeks, today),
        records=records,
    )
