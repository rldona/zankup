"""Scheduled syncs: one job per slot, pruning, and the sync job running a real (mocked) sync."""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
import respx
from sqlalchemy import create_engine, func, select, update
from sqlalchemy.orm import Session, sessionmaker

from opensport.db.models import Activity, Job, SyncRun
from opensport.jobs.handlers import default_handlers
from opensport.jobs.scheduler import Scheduler
from opensport.jobs.worker import Worker
from opensport.storage import LocalRawStore
from tests.test_sync import garmin_api  # noqa: F401 - fixture serving the scrubbed Garmin page and FITs

T0 = datetime(2020, 1, 11, 10, 0, tzinfo=UTC)


@pytest.fixture
def sessions(database: str) -> Iterator[sessionmaker[Session]]:
    engine = create_engine(database)
    yield sessionmaker(engine, expire_on_commit=False)
    engine.dispose()


def scheduler(sessions: sessionmaker[Session]) -> Scheduler:
    return Scheduler(sessions, interval=timedelta(minutes=15), owner_email="owner@example.com")


def jobs(sessions: sessionmaker[Session], kind: str) -> int:
    with sessions() as session:
        return session.scalar(select(func.count()).select_from(Job).where(Job.kind == kind)) or 0


def test_one_sync_per_slot_however_many_ticks(sessions: sessionmaker[Session]) -> None:
    s = scheduler(sessions)
    assert s.tick(T0) is not None
    assert s.tick(T0 + timedelta(minutes=5)) is None  # same 15-minute slot
    assert s.tick(T0 + timedelta(minutes=14, seconds=59)) is None
    assert s.tick(T0 + timedelta(minutes=15)) is not None  # next slot
    assert jobs(sessions, "sync_garmin") == 2


def test_a_restarted_api_does_not_queue_twice(sessions: sessionmaker[Session]) -> None:
    assert scheduler(sessions).tick(T0) is not None
    assert scheduler(sessions).tick(T0 + timedelta(seconds=30)) is None  # a new Scheduler, same slot


def test_old_finished_jobs_are_pruned(sessions: sessionmaker[Session]) -> None:
    s = scheduler(sessions)
    s.tick(T0)
    with sessions.begin() as session:
        session.execute(update(Job).values(status="done", finished_at=T0 - timedelta(days=15)))
    s.tick(T0 + timedelta(minutes=15))
    with sessions() as session:
        assert [j.status for j in session.scalars(select(Job))] == ["queued"]


def test_the_sync_job_runs_a_sync_and_queues_imports(
    sessions: sessionmaker[Session],
    garmin_api: respx.Router,  # noqa: F811
    tmp_path: Path,
) -> None:
    scheduler(sessions).tick()
    store = LocalRawStore(tmp_path)
    worker = Worker(sessions, default_handlers(store, sessions, "test-key"))
    with (
        sessions.begin() as session
    ):  # the first sync looks 30 days back from today; widen it for the fixtures
        session.execute(update(Job).values(payload={"trigger": "cron", "since": "2020-01-01"}))
    processed = 0
    while worker.run_once():
        processed += 1
    assert processed == 4  # the sync, then the three imports it queued
    with sessions() as session:
        assert session.scalar(select(func.count()).select_from(Activity)) == 3
        run = session.scalars(select(SyncRun)).one()
        assert run.trigger == "cron" and run.status == "success"


def test_without_garmin_key_there_is_no_sync_handler(tmp_path: Path) -> None:
    assert "sync_garmin" not in default_handlers(LocalRawStore(tmp_path))
