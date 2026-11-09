"""The metrics engine (OS-313, OS-314) over the three anonymised FITs: what an import computes, the
full recomputation, records, routes and segments."""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import func, select, update

from tests.test_activities import Ctx, ctx  # noqa: F401 - three imported FITs and a signed-in client
from zankup.db.models import (
    Activity,
    ActivityMetrics,
    BestEffort,
    DailyLoad,
    EngineRun,
    EstimateRow,
    Event,
    Job,
    Segment,
    SegmentEffort,
)
from zankup.engine import METRICS_VERSION
from zankup.engine.run import outdated_users, queue_full, queue_segment
from zankup.fit.streams import decode_polyline, encode_polyline
from zankup.jobs.handlers import default_handlers
from zankup.jobs.queue import now
from zankup.jobs.worker import Worker


def drain(context: Ctx) -> int:
    """Run every queued job now (the user-level recompute waits a few seconds on purpose)."""
    worker = Worker(context.sessions, default_handlers(context.store, context.sessions))
    done = 0
    while True:
        with context.sessions.begin() as db:
            db.execute(update(Job).where(Job.status == "queued").values(run_after=now()))
        if not worker.run_once():
            return done
        done += 1


def recent(context: Ctx) -> None:
    """The fixtures are from 2020: bring them into the estimates' 90-day window."""
    with context.sessions.begin() as db:
        for days, activity_id in enumerate(context.ids.values(), start=1):
            db.execute(
                update(Activity)
                .where(Activity.id == activity_id)
                .values(start_utc=datetime.now(UTC) - timedelta(days=days))
            )


def test_an_import_computes_its_metrics_and_the_users(ctx: Ctx) -> None:  # noqa: F811
    recent(ctx)
    assert drain(ctx) >= 4  # three activities and one user-level recompute
    with ctx.sessions() as db:
        run = db.get_one(ActivityMetrics, ctx.ids["run"])
        assert run.metrics_version == METRICS_VERSION
        assert run.trimp and run.trimp > 0
        assert run.hr_zones and sum(run.hr_zones) > 0
        assert run.speed_curve and "60" in run.speed_curve
        assert run.gap_distance_m and run.gap_distance_m > 0
        ride = db.get_one(ActivityMetrics, ctx.ids["ride-power"])
        assert ride.power_curve and ride.power_curve["5"] >= ride.power_curve["60"]
        assert db.scalar(select(func.count()).select_from(DailyLoad)) > 0
        kinds = set(db.scalars(select(EstimateRow.kind)))
        assert "hr_max" in kinds
        estimate = db.scalar(select(EstimateRow).where(EstimateRow.kind == "hr_max"))
        assert estimate is not None and estimate.source_activity_ids
        assert outdated_users(db) == []


def test_full_recomputation_reports_progress_and_is_idempotent(ctx: Ctx) -> None:  # noqa: F811
    drain(ctx)
    with ctx.sessions() as db:
        before = {m.activity_id: m.trimp for m in db.scalars(select(ActivityMetrics))}
        other = db.get_one(Activity, ctx.other_id).user_id
        user_id = db.get_one(Activity, ctx.ids["run"]).user_id
    with ctx.sessions.begin() as db:
        db.execute(
            update(ActivityMetrics).where(ActivityMetrics.user_id == user_id).values(metrics_version=0)
        )
        assert user_id in outdated_users(db) and other != user_id
        queue_full(db, user_id, "test")
        queue_full(db, user_id, "test")  # one is enough
        assert (
            db.scalar(
                select(func.count())
                .select_from(Job)
                .where(Job.kind == "metrics_full", Job.status == "queued")
            )
            == 1
        )
    drain(ctx)
    with ctx.sessions() as db:
        run = db.scalars(select(EngineRun).where(EngineRun.user_id == user_id)).one()
        assert run.status == "success" and run.done == run.total == 3
        after = {m.activity_id: m.trimp for m in db.scalars(select(ActivityMetrics))}
        assert after == before
        assert user_id not in outdated_users(db)


def test_a_faster_effort_is_a_record_event(ctx: Ctx) -> None:  # noqa: F811
    drain(ctx)
    with ctx.sessions.begin() as db:
        run = db.get_one(Activity, ctx.ids["run"])
        effort = db.scalars(select(BestEffort).where(BestEffort.activity_id == run.id)).first()
        assert effort is not None
        older = Activity(
            user_id=run.user_id,
            source="garmin",
            external_id="older",
            sport="run",
            start_utc=run.start_utc - timedelta(days=30),
            duration_s=3000,
        )
        db.add(older)
        db.flush()
        db.add(
            BestEffort(
                activity_id=older.id,
                user_id=run.user_id,
                distance_key=effort.distance_key,
                distance_m=effort.distance_m,
                time_s=effort.time_s + 30,
                start_s=0,
                start_distance_m=0,
            )
        )
        from zankup.engine.run import queue_activity

        queue_activity(db, run.user_id, run.id)
    drain(ctx)
    with ctx.sessions() as db:
        events = db.scalars(select(Event).where(Event.kind == "record")).all()
        assert any(e.payload["distance_key"] == effort.distance_key for e in events)


def test_same_route_activities_are_grouped(ctx: Ctx) -> None:  # noqa: F811
    with ctx.sessions.begin() as db:
        run = db.get_one(Activity, ctx.ids["run"])
        twin = Activity(
            user_id=run.user_id,
            source="garmin",
            external_id="twin",
            sport="run",
            start_utc=run.start_utc + timedelta(days=7),
            duration_s=run.duration_s,
            route_simplified=run.route_simplified,
            has_gps=True,
        )
        db.add(twin)
        db.flush()
        twin_id = twin.id
        from zankup.engine.run import queue_activity

        queue_activity(db, run.user_id, twin_id)
    drain(ctx)
    with ctx.sessions() as db:
        assert db.get_one(ActivityMetrics, twin_id).route_group == ctx.ids["run"]


def test_a_segment_is_found_in_the_activity_it_came_from(ctx: Ctx) -> None:  # noqa: F811
    from zankup.engine.activity import series_of

    drain(ctx)
    with ctx.sessions.begin() as db:
        run = db.get_one(Activity, ctx.ids["run"])
        series = series_of(db, run.id)
        assert series is not None
        points = [
            (la, lo)
            for la, lo in zip(series["lat"], series["lon"], strict=True)
            if la is not None and lo is not None
        ]
        stretch = points[len(points) // 4 : len(points) // 2]
        segment = Segment(
            user_id=run.user_id, name="Hill", track=encode_polyline(stretch, 6), distance_m=1000
        )
        db.add(segment)
        db.flush()
        assert decode_polyline(segment.track, 6)[0] == pytest.approx(stretch[0], abs=1e-6)
        queue_segment(db, run.user_id, segment.id)
    drain(ctx)
    with ctx.sessions() as db:
        effort = db.scalars(select(SegmentEffort)).one()
        assert effort.activity_id == ctx.ids["run"] and effort.elapsed_s > 0


def test_daily_load_carries_fitness_to_today(ctx: Ctx) -> None:  # noqa: F811
    drain(ctx)
    with ctx.sessions() as db:
        last = db.scalar(select(func.max(DailyLoad.day)))
        assert last == datetime.now(UTC).date() or last == date.today()
