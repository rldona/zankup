"""Sync orchestrator against a mocked Personal API serving the fixtures, on a throwaway database."""

import io
import json
import zipfile
from collections.abc import Iterator
from datetime import date
from pathlib import Path

import httpx
import pytest
import respx
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import Session, sessionmaker

from opensport.db.models import Activity, Job, Source, SyncRun
from opensport.jobs.handlers import default_handlers
from opensport.jobs.worker import Worker
from opensport.storage import LocalRawStore
from opensport.sync.garmin import (
    BASE_URL,
    DOWNLOAD_PATH,
    LIST_PATH,
    TOKEN_PATH,
    GarminClient,
    MemoryTokenCache,
)
from opensport.sync.orchestrator import LOCK_NAMESPACE, SyncAlreadyRunning, run_sync
from opensport.users import ensure_owner

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
PAGE = json.loads((FIXTURES / "garmin" / "activity-list.json").read_text())
FIT_FOR = {"Running": "run", "Strength Training": "strength", "Virtual Ride": "ride-power"}


def zipped(name: str) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(f"{name}.fit", (FIXTURES / "fit" / f"{name}.fit").read_bytes())
    return buffer.getvalue()


@pytest.fixture
def sessions(database: str) -> Iterator[sessionmaker[Session]]:
    engine = create_engine(database)
    yield sessionmaker(engine, expire_on_commit=False)
    engine.dispose()


@pytest.fixture
def garmin_api() -> Iterator[respx.Router]:
    with respx.mock(assert_all_called=False) as router:
        router.post(BASE_URL + TOKEN_PATH).mock(return_value=httpx.Response(200, text="not-a-jwt-token"))
        router.get(BASE_URL + LIST_PATH).mock(return_value=httpx.Response(200, json=PAGE))
        for activity in PAGE:
            router.get(BASE_URL + DOWNLOAD_PATH.format(id=activity["activityId"])).mock(
                return_value=httpx.Response(200, content=zipped(FIT_FOR[activity["activityName"]]))
            )
        yield router


def setup(sessions: sessionmaker[Session], tmp_path: Path) -> tuple[int, LocalRawStore, GarminClient]:
    with sessions.begin() as session:
        user_id = ensure_owner(session, "owner@example.com").id
    return user_id, LocalRawStore(tmp_path), GarminClient("key", MemoryTokenCache(), http=httpx.Client())


def count(sessions: sessionmaker[Session], model: type) -> int:
    with sessions() as session:
        return session.scalar(select(func.count()).select_from(model)) or 0


def test_sync_downloads_queues_and_the_worker_imports(
    sessions: sessionmaker[Session], garmin_api: respx.Router, tmp_path: Path
) -> None:
    user_id, store, garmin = setup(sessions, tmp_path)
    result = run_sync(sessions, store, garmin, user_id=user_id, since=date(2020, 1, 1), sleep=lambda _: None)
    assert (result.listed, result.queued, result.skipped) == (3, 3, 0)
    assert count(sessions, Job) == 3 and count(sessions, Activity) == 0

    with sessions() as session:
        run = session.get_one(SyncRun, result.run_id)
        assert run.status == "success" and run.new_count == 3 and run.progress["downloaded"] == 3
        assert session.scalar(select(Source.last_sync_at)) is not None

    worker = Worker(sessions, default_handlers(store))
    while worker.run_once():
        pass
    with sessions() as session:
        names = sorted(session.scalars(select(Activity.name)))
    assert names == ["Running", "Strength Training", "Virtual Ride"]


def test_second_run_does_nothing(
    sessions: sessionmaker[Session], garmin_api: respx.Router, tmp_path: Path
) -> None:
    user_id, store, garmin = setup(sessions, tmp_path)
    run_sync(sessions, store, garmin, user_id=user_id, since=date(2020, 1, 1), sleep=lambda _: None)
    downloads_before = sum(r.call_count for r in garmin_api.routes if "download" in str(r.pattern))

    again = run_sync(sessions, store, garmin, user_id=user_id, since=date(2020, 1, 1), sleep=lambda _: None)
    assert (again.queued, again.skipped) == (0, 3)
    assert count(sessions, Job) == 3
    assert sum(r.call_count for r in garmin_api.routes if "download" in str(r.pattern)) == downloads_before


def test_only_one_sync_at_a_time(
    sessions: sessionmaker[Session], garmin_api: respx.Router, tmp_path: Path
) -> None:
    user_id, store, garmin = setup(sessions, tmp_path)
    with sessions() as other:  # another process holding the lock
        other.execute(text("SELECT pg_advisory_lock(:k)"), {"k": LOCK_NAMESPACE * 1_000_000 + user_id})
        with pytest.raises(SyncAlreadyRunning):
            run_sync(sessions, store, garmin, user_id=user_id, sleep=lambda _: None)
        other.execute(text("SELECT pg_advisory_unlock_all()"))
    assert count(sessions, SyncRun) == 0


def test_a_failed_sync_is_recorded(
    sessions: sessionmaker[Session], garmin_api: respx.Router, tmp_path: Path
) -> None:
    user_id, store, garmin = setup(sessions, tmp_path)
    garmin_api.get(BASE_URL + LIST_PATH).mock(return_value=httpx.Response(400, text="bad request"))
    with pytest.raises(Exception, match="HTTP 400"):
        run_sync(sessions, store, garmin, user_id=user_id, sleep=lambda _: None)
    with sessions() as session:
        run = session.scalars(select(SyncRun)).one()
        assert run.status == "error" and "HTTP 400" in (run.error or "") and run.finished_at is not None
        assert session.scalar(select(Source.last_sync_at)) is None  # a failed sync does not move the cursor


def test_owner_is_created_once(sessions: sessionmaker[Session]) -> None:
    with sessions.begin() as session:
        first = ensure_owner(session, "owner@example.com").id
    with sessions.begin() as session:
        assert ensure_owner(session, "other@example.com").id == first
