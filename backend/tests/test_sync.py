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

from zankup.db.models import Activity, Job, Source, SyncRun
from zankup.jobs.handlers import default_handlers
from zankup.jobs.worker import Worker
from zankup.storage import LocalRawStore
from zankup.sync import orchestrator
from zankup.sync.garmin import (
    BASE_URL,
    DOWNLOAD_PATH,
    LIST_PATH,
    TOKEN_PATH,
    GarminClient,
    MemoryTokenCache,
)
from zankup.sync.orchestrator import LOCK_NAMESPACE, SyncAlreadyRunning, history_windows, run_sync
from zankup.users import ensure_owner

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


def test_history_windows_cover_the_range_without_overlap() -> None:
    windows = history_windows(date(2020, 1, 1), date(2020, 1, 10), days=4)
    assert windows == [
        (date(2020, 1, 1), date(2020, 1, 4)),
        (date(2020, 1, 5), date(2020, 1, 8)),
        (date(2020, 1, 9), date(2020, 1, 10)),
    ]
    assert history_windows(date(2020, 1, 1), date(2020, 1, 1)) == [(date(2020, 1, 1), date(2020, 1, 1))]


def by_dates(request: httpx.Request) -> httpx.Response:
    """The list endpoint, filtering the fixture page by startDate and endDate like the real API."""
    first, last = (date.fromisoformat(request.url.params[k]) for k in ("startDate", "endDate"))
    page = [a for a in PAGE if first <= date.fromisoformat(a["startTimeGMT"][:10]) <= last]
    return httpx.Response(200, json=page[int(request.url.params["start"]) :][:50])


def test_history_load_goes_window_by_window_oldest_first(
    sessions: sessionmaker[Session],
    garmin_api: respx.Router,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(orchestrator, "WINDOW_DAYS", 365)
    listing = garmin_api.get(BASE_URL + LIST_PATH).mock(side_effect=by_dates)
    user_id, store, garmin = setup(sessions, tmp_path)
    pauses: list[float] = []
    result = run_sync(
        sessions,
        store,
        garmin,
        user_id=user_id,
        trigger="initial",
        since=date(2019, 1, 11),
        sleep=pauses.append,
    )
    assert (result.listed, result.queued) == (3, 3) and pauses == [1.0, 1.0]  # between downloads only
    first_call = listing.calls[0].request.url.params
    assert (first_call["startDate"], first_call["endDate"]) == ("2019-01-11", "2020-01-10")
    with sessions() as session:
        jobs = session.scalars(select(Job).order_by(Job.id)).all()
        run = session.get_one(SyncRun, result.run_id)
    queued = [job.payload["external_id"] for job in jobs]
    assert queued[0] == "9000000003" and set(queued[1:]) == {"9000000001", "9000000002"}  # older window first
    assert run.progress["window"] == run.progress["windows"] == listing.call_count


def test_an_interrupted_load_is_recorded_and_resumes(
    sessions: sessionmaker[Session], garmin_api: respx.Router, tmp_path: Path
) -> None:
    user_id, store, garmin = setup(sessions, tmp_path)
    downloads = 0

    def interrupt_after_one(_: float) -> None:
        nonlocal downloads
        downloads += 1
        raise KeyboardInterrupt  # Ctrl+C during the pause after the first download

    with pytest.raises(KeyboardInterrupt):
        run_sync(sessions, store, garmin, user_id=user_id, since=date(2020, 1, 1), sleep=interrupt_after_one)
    with sessions() as session:
        run = session.scalars(select(SyncRun)).one()
        assert run.status == "error" and run.error == "KeyboardInterrupt"
    assert count(sessions, Job) == 1

    again = run_sync(sessions, store, garmin, user_id=user_id, since=date(2020, 1, 1), sleep=lambda _: None)
    assert (again.queued, again.skipped) == (2, 1) and count(sessions, Job) == 3


def test_cli_loads_history_and_imports(
    sessions: sessionmaker[Session],
    garmin_api: respx.Router,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    from pydantic import SecretStr

    from zankup.core.config import Settings
    from zankup.sync import __main__ as cli

    settings = Settings(  # type: ignore[call-arg]
        _env_file=None,
        garmin_personal_api_key=SecretStr("key"),
        data_dir=tmp_path,
        owner_email="o@example.com",
    )
    monkeypatch.setattr(cli, "get_settings", lambda: settings)
    monkeypatch.setattr(cli, "get_engine", lambda: sessions.kw["bind"])
    assert cli.main(["--all", "--pause", "0"]) == 0
    assert "queued 3 new" in capsys.readouterr().out
    assert count(sessions, Activity) == 3
    with sessions() as session:
        assert session.scalars(select(SyncRun.trigger)).one() == "initial"
