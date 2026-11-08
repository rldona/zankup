"""This week (OS-217): days in local time, totals, the weeks before, streak and recent records."""

from datetime import UTC, date, datetime, timedelta

from tests.test_profile import Ctx, ctx  # noqa: F401 - signed-in client and database
from zankup.db.models import Activity, BestEffort

TODAY = date(2026, 11, 5)  # a Thursday


def add(
    context: Ctx,
    external_id: str,
    start: datetime,
    sport: str = "run",
    timezone: str | None = "+01:00",
    distance: float = 10000,
) -> int:
    with context.sessions.begin() as db:
        activity = Activity(
            user_id=context.user_id,
            source="garmin",
            external_id=external_id,
            sport=sport,
            name=external_id,
            start_utc=start,
            timezone=timezone,
            duration_s=3600,
            moving_s=3000,
            distance_m=distance,
            ascent_m=50,
        )
        db.add(activity)
        db.flush()
        return activity.id


def test_this_week(ctx: Ctx) -> None:  # noqa: F811
    monday = datetime(2026, 11, 2, tzinfo=UTC)
    add(ctx, "mon", monday + timedelta(hours=7))
    add(ctx, "wed", monday + timedelta(days=2, hours=18), sport="ride", distance=30000)
    # 23:30 UTC on Sunday 1 November is already Monday 2 in its own time zone (+01:00)
    add(ctx, "late", datetime(2026, 11, 1, 23, 30, tzinfo=UTC))
    add(ctx, "last-week", monday - timedelta(days=3))
    week = ctx.http.get("/api/week", params={"today": TODAY.isoformat()}).json()
    assert week["days"][0]["date"] == "2026-11-02" and len(week["days"]) == 7
    assert [a["name"] for a in week["days"][0]["activities"]] == ["late", "mon"]
    assert week["days"][2]["activities"][0]["sport"] == "ride"
    assert week["days"][6]["activities"] == []  # Sunday, still to come
    assert week["this_week"]["count"] == 3 and week["this_week"]["distance_m"] == 50000
    assert week["previous"][0]["week_start"] == "2026-10-26" and week["previous"][0]["count"] == 1
    assert len(week["previous"]) == 12 and week["previous"][5]["count"] == 0
    assert week["streak_weeks"] == 2  # this week and the one before


def test_recent_records_are_all_time_bests_only(ctx: Ctx) -> None:  # noqa: F811
    old = add(ctx, "old", datetime(2025, 3, 1, tzinfo=UTC))
    recent = add(ctx, "recent", datetime(2026, 11, 3, 8, tzinfo=UTC))
    with ctx.sessions.begin() as db:
        for activity_id, key, seconds in ((old, "5k", 1300), (recent, "5k", 1400), (recent, "10k", 2800)):
            db.add(
                BestEffort(
                    activity_id=activity_id,
                    user_id=ctx.user_id,
                    distance_key=key,
                    distance_m=5000 if key == "5k" else 10000,
                    time_s=seconds,
                    start_s=0,
                    start_distance_m=0,
                )
            )
    records = ctx.http.get("/api/week", params={"today": TODAY.isoformat()}).json()["records"]
    assert [(r["distance_key"], r["activity_id"]) for r in records] == [
        ("10k", recent)
    ]  # the 5 km best is old
