"""The Sync button: POST /api/sync, the worker running it against the mocked Personal API, polling."""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
import respx
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine, select, text, update
from sqlalchemy.orm import Session, sessionmaker

from tests.test_sync import garmin_api  # noqa: F401 - fixture serving the scrubbed Garmin page and FITs
from zankup.api.main import create_app
from zankup.auth.deps import SESSION_COOKIE
from zankup.auth.security import new_token
from zankup.core.config import Settings, get_settings
from zankup.db.models import Activity, Device, Job, SyncRun, User
from zankup.db.session import get_engine, get_session
from zankup.jobs.handlers import default_handlers
from zankup.jobs.worker import Worker
from zankup.storage import LocalRawStore
from zankup.sync.orchestrator import LOCK_NAMESPACE

SETTINGS = Settings(  # type: ignore[call-arg]
    _env_file=None,
    environment="test",
    jwt_secret=SecretStr("test-secret"),
    garmin_personal_api_key=SecretStr("key"),
    run_worker=False,
)


@dataclass
class Ctx:
    http: TestClient
    sessions: sessionmaker[Session]
    worker: Worker
    user_id: int


@pytest.fixture
def ctx(database: str, tmp_path: Path) -> Iterator[Ctx]:
    engine = create_engine(database)
    sessions = sessionmaker(engine, expire_on_commit=False)

    def session() -> Iterator[Session]:
        with sessions() as db:
            yield db

    token, digest = new_token()
    with sessions.begin() as db:
        user = User(email="runner@example.com")
        db.add(user)
        db.flush()
        user_id = user.id
        db.add(
            Device(
                user_id=user.id,
                name="Browser",
                platform="web",
                refresh_token_hash=digest,
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
    app = create_app(SETTINGS)
    app.dependency_overrides[get_session] = session
    app.dependency_overrides[get_settings] = lambda: SETTINGS
    app.dependency_overrides[get_engine] = lambda: engine
    http = TestClient(app)
    http.cookies.set(SESSION_COOKIE, token)
    worker = Worker(sessions, default_handlers(LocalRawStore(tmp_path), sessions, "key"), name="test")
    yield Ctx(http, sessions, worker, user_id)
    engine.dispose()


def drain(worker: Worker) -> None:
    while worker.run_once():
        pass


def make_due(sessions: sessionmaker[Session]) -> None:
    with sessions.begin() as db:
        db.execute(update(Job).where(Job.status == "queued").values(run_after=datetime.now(UTC)))


def test_button_sync_end_to_end(ctx: Ctx, garmin_api: respx.Router) -> None:  # noqa: F811
    started = ctx.http.post("/api/sync")
    assert started.status_code == 202
    run = started.json()
    assert run["status"] == "queued" and run["trigger"] == "button"

    drain(ctx.worker)  # the sync, then the three imports it queued
    done = ctx.http.get(f"/api/sync/{run['id']}").json()
    assert done["status"] == "success" and done["new_count"] == 3 and done["finished_at"]
    progress = done["progress"]
    assert (progress["listed"], progress["new"], progress["downloaded"]) == (3, 3, 3)
    assert progress["window"] == progress["windows"] == 1
    assert done["pending_imports"] == 0
    assert len(ctx.http.get("/api/activities").json()["items"]) == 3

    again = ctx.http.post("/api/sync").json()
    drain(ctx.worker)
    assert ctx.http.get(f"/api/sync/{again['id']}").json()["new_count"] == 0  # incremental
    assert [r["id"] for r in ctx.http.get("/api/sync").json()] == [again["id"], run["id"]]


def test_pressing_twice_returns_the_same_run(ctx: Ctx) -> None:
    first = ctx.http.post("/api/sync")
    second = ctx.http.post("/api/sync")
    assert first.status_code == 202 and second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    with ctx.sessions() as db:
        assert len(db.scalars(select(Job).where(Job.kind == "sync_garmin")).all()) == 1


def test_a_stuck_run_does_not_block_the_button(ctx: Ctx) -> None:
    first = ctx.http.post("/api/sync").json()
    with ctx.sessions.begin() as db:
        db.execute(update(SyncRun).values(started_at=datetime.now(UTC) - timedelta(hours=1)))
    assert ctx.http.post("/api/sync").json()["id"] != first["id"]


def test_waits_for_a_sync_already_running(ctx: Ctx, garmin_api: respx.Router) -> None:  # noqa: F811
    run = ctx.http.post("/api/sync").json()
    key = LOCK_NAMESPACE * 1_000_000 + ctx.user_id
    with ctx.sessions() as holder:  # a scheduled sync holds the lock
        holder.execute(text("SELECT pg_advisory_lock(:k)"), {"k": key})
        drain(ctx.worker)
        assert ctx.http.get(f"/api/sync/{run['id']}").json()["status"] == "queued"
        holder.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": key})
        holder.commit()
    make_due(ctx.sessions)  # skip the backoff
    drain(ctx.worker)
    assert ctx.http.get(f"/api/sync/{run['id']}").json()["status"] == "success"


def test_a_failed_sync_is_reported_and_not_retried(ctx: Ctx, garmin_api: respx.Router) -> None:  # noqa: F811
    from zankup.sync.garmin import BASE_URL, LIST_PATH

    garmin_api.get(BASE_URL + LIST_PATH).respond(400, json={"message": "bad request"})
    run = ctx.http.post("/api/sync").json()
    drain(ctx.worker)
    failed = ctx.http.get(f"/api/sync/{run['id']}").json()
    assert failed["status"] == "error" and failed["error"] and failed["finished_at"]
    with ctx.sessions() as db:
        job = db.scalars(select(Job).where(Job.kind == "sync_garmin")).one()
        assert job.status == "done" and db.scalar(select(Activity.id)) is None


def test_without_garmin_the_button_says_so(ctx: Ctx) -> None:
    settings = SETTINGS.model_copy(update={"garmin_personal_api_key": None})
    ctx.http.app.dependency_overrides[get_settings] = lambda: settings  # type: ignore[attr-defined]
    assert ctx.http.post("/api/sync").status_code == 409


def test_someone_elses_sync_is_not_found(ctx: Ctx) -> None:
    with ctx.sessions.begin() as db:
        other = User(email="someone@example.com")
        db.add(other)
        db.flush()
        run = SyncRun(user_id=other.id, trigger="cron", status="success")
        db.add(run)
        db.flush()
        run_id = run.id
    assert ctx.http.get(f"/api/sync/{run_id}").status_code == 404
    assert ctx.http.get("/api/sync").json() == []


def test_the_whole_history_is_a_background_job_that_resumes(ctx: Ctx) -> None:
    started = ctx.http.post("/api/sync", json={"history": True})
    assert started.status_code == 202
    run = started.json()
    assert run["trigger"] == "initial" and run["status"] == "queued"
    with ctx.sessions() as db:
        job = db.scalars(select(Job).where(Job.kind == "sync_garmin")).one()
        assert job.payload == {"trigger": "initial", "run_id": run["id"], "since": "2000-01-01"}
    # Hours later it is still the same load: pressing again follows it instead of starting another.
    with ctx.sessions.begin() as db:
        db.execute(update(SyncRun).values(started_at=datetime.now(UTC) - timedelta(hours=3)))
    assert ctx.http.post("/api/sync", json={"history": True}).json()["id"] == run["id"]
    assert ctx.http.post("/api/sync").json()["id"] == run["id"]
