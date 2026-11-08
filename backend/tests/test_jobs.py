"""Job queue and worker on a throwaway database."""

import threading
import time
from collections.abc import Iterator
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import Session, sessionmaker

from zankup.api.main import app
from zankup.db.models import Activity, Job, User
from zankup.db.session import get_engine
from zankup.jobs.handlers import default_handlers
from zankup.jobs.queue import backoff, claim, enqueue, now, requeue_stale
from zankup.jobs.worker import Worker, split
from zankup.storage import LocalRawStore, raw_key

FIT = (Path(__file__).resolve().parents[2] / "fixtures" / "fit" / "run.fit").read_bytes()


@pytest.fixture
def sessions(database: str) -> Iterator[sessionmaker[Session]]:
    engine = create_engine(database)
    factory = sessionmaker(engine, expire_on_commit=False)
    with factory.begin() as session:
        session.add(User(email="runner@example.com"))
    yield factory
    engine.dispose()


def uid(sessions: sessionmaker[Session]) -> int:
    with sessions() as session:
        return session.scalars(select(User.id)).one()


def job(sessions: sessionmaker[Session], job_id: int) -> Job:
    with sessions() as session:
        return session.get_one(Job, job_id)


def test_backoff_doubles_and_is_capped() -> None:
    assert [backoff(n).total_seconds() for n in (1, 2, 3)] == [30, 60, 120]
    assert backoff(20) == timedelta(hours=1)


def test_dedupe_key_queues_work_once(sessions: sessionmaker[Session]) -> None:
    with sessions.begin() as session:
        first = enqueue(session, "noop", user_id=uid(sessions), dedupe_key="garmin:1")
        second = enqueue(session, "noop", user_id=uid(sessions), dedupe_key="garmin:1")
    assert first is not None and second is None


def test_two_workers_never_take_the_same_job(sessions: sessionmaker[Session]) -> None:
    with sessions.begin() as session:
        for n in range(2):
            enqueue(session, "noop", user_id=uid(sessions), payload={"n": n})
    with sessions() as a, sessions() as b:
        first, second = (
            claim(a, "a"),
            claim(b, "b"),
        )  # both transactions open: the second skips the locked row
        assert first is not None and second is not None and first.id != second.id
        assert claim(b, "b") is None
        a.commit()
        b.commit()


def test_future_jobs_wait(sessions: sessionmaker[Session]) -> None:
    with sessions.begin() as session:
        enqueue(session, "noop", user_id=uid(sessions), run_after=now() + timedelta(minutes=5))
    with sessions() as session:
        assert claim(session, "w") is None


def test_failures_retry_with_backoff_then_give_up(sessions: sessionmaker[Session]) -> None:
    calls: list[int] = []

    def flaky(_: Session, job: Job) -> None:
        calls.append(job.attempts)
        raise RuntimeError("Garmin is down")

    with sessions.begin() as session:
        job_id = enqueue(session, "flaky", user_id=uid(sessions), max_attempts=2)
    worker = Worker(sessions, {"flaky": flaky})
    assert worker.run_once()
    retried = job(sessions, job_id or 0)
    assert (
        retried.status == "queued"
        and retried.attempts == 1
        and "Garmin is down" in (retried.last_error or "")
    )
    assert retried.run_after > now() + timedelta(seconds=25)

    with sessions.begin() as session:  # pretend the backoff has passed
        session.execute(update(Job).values(run_after=now()))
    assert worker.run_once()
    assert job(sessions, job_id or 0).status == "failed" and calls == [1, 2]
    assert not worker.run_once()  # nothing left


def test_a_failed_job_rolls_back_its_work(sessions: sessionmaker[Session]) -> None:
    def half_done(session: Session, job: Job) -> None:
        session.add(User(email="should-not-exist@example.com"))
        session.flush()
        raise ValueError("boom")

    with sessions.begin() as session:
        enqueue(session, "half", user_id=uid(sessions), max_attempts=1)
    Worker(sessions, {"half": half_done}).run_once()
    with sessions() as session:
        assert session.scalars(select(User.email)).all() == ["runner@example.com"]


def test_stale_running_jobs_are_requeued(sessions: sessionmaker[Session]) -> None:
    with sessions.begin() as session:
        job_id = enqueue(session, "noop", user_id=uid(sessions))
        session.execute(update(Job).values(status="running", locked_at=now() - timedelta(hours=1)))
    with sessions.begin() as session:
        assert requeue_stale(session) == 1
    assert job(sessions, job_id or 0).status == "queued"


def test_ingest_job_imports_a_stored_fit(sessions: sessionmaker[Session], tmp_path: Path) -> None:
    store, user_id = LocalRawStore(tmp_path), uid(sessions)
    key = raw_key(user_id, "garmin", "9000000002")
    store.put(key, FIT)
    with sessions.begin() as session:
        job_id = enqueue(
            session,
            "ingest_fit",
            user_id=user_id,
            payload={
                "source": "garmin",
                "external_id": "9000000002",
                "key": key,
                "meta": {"activityName": "Run"},
            },
        )
    assert Worker(sessions, default_handlers(store)).run_once()
    assert job(sessions, job_id or 0).status == "done"
    with sessions() as session:
        activity = session.scalars(select(Activity)).one()
        assert activity.name == "Run" and activity.fit_path == key


def test_the_api_answers_while_the_worker_is_busy(sessions: sessionmaker[Session], database: str) -> None:
    started, release = threading.Event(), threading.Event()

    def slow(_: Session, __: Job) -> None:
        started.set()
        release.wait(10)

    with sessions.begin() as session:
        enqueue(session, "slow", user_id=uid(sessions))
    worker = Worker(sessions, {"slow": slow}, poll_interval_s=0.05)
    thread = worker.start_thread()
    try:
        assert started.wait(5)
        engine = create_engine(database)
        app.dependency_overrides[get_engine] = lambda: engine
        begin = time.monotonic()
        response = TestClient(app).get("/api/health")
        assert response.status_code == 200 and time.monotonic() - begin < 2
        app.dependency_overrides.clear()
        engine.dispose()
    finally:
        release.set()
        worker.stop()
        thread.join(5)


def test_a_long_job_keeps_its_lock_fresh(sessions: sessionmaker[Session]) -> None:
    started, release = threading.Event(), threading.Event()

    def long(_: Session, __: Job) -> None:
        started.set()
        release.wait(10)

    with sessions.begin() as session:
        job_id = enqueue(session, "long", user_id=uid(sessions))
    worker = Worker(sessions, {"long": long}, poll_interval_s=0.05, heartbeat_s=0.05)
    thread = worker.start_thread()
    try:
        assert started.wait(5)
        with sessions() as session:
            first = session.get_one(Job, job_id).locked_at
        time.sleep(0.3)
        with sessions() as session:
            assert session.get_one(Job, job_id).locked_at > first  # type: ignore[operator]
            assert requeue_stale(session, timedelta(seconds=1)) == 0  # alive, so not stale
    finally:
        release.set()
        worker.stop()
        thread.join(5)


def test_long_jobs_and_imports_get_their_own_workers() -> None:
    def handler(_: Session, __: Job) -> None: ...

    long, short = split({"sync_garmin": handler, "backup": handler, "ingest_fit": handler})
    assert sorted(long) == ["backup", "sync_garmin"] and list(short) == ["ingest_fit"]
