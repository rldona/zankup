"""Backups: dump + FIT files to a destination, retention, and a restore that the app works with.

Needs `pg_dump` and `pg_restore` of the server's major version (or PG_DUMP_COMMAND / PG_RESTORE_COMMAND
pointing at them, e.g. through `docker exec`). Skipped without them, except in CI (REQUIRE_DB=1).
"""

import json
import os
import shlex
import shutil
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from tests.conftest import throwaway_database
from zankup.api.activities import get_store
from zankup.api.main import create_app
from zankup.auth.deps import SESSION_COOKIE
from zankup.auth.security import new_token
from zankup.backup import MANIFEST, BackupError, LocalObjectStore, dump_key, restore, run_backup
from zankup.core.config import Settings, get_settings
from zankup.db.models import Activity, Device, User
from zankup.db.session import get_engine, get_session
from zankup.ingest import ingest_fit
from zankup.storage import LocalRawStore

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
DAY = date(2026, 11, 8)


def settings_for(tmp_path: Path, **extra: object) -> Settings:
    return Settings(  # type: ignore[call-arg]
        _env_file=None,
        environment="test",
        jwt_secret=SecretStr("test-secret"),
        run_worker=False,
        data_dir=tmp_path / "data",
        **extra,
    )


@pytest.fixture(autouse=True)
def pg_tools(tmp_path: Path) -> None:
    settings = settings_for(tmp_path)
    for command in (settings.pg_dump_command, settings.pg_restore_command):
        if shutil.which(shlex.split(command)[0]) is None:
            if os.environ.get("REQUIRE_DB") == "1":
                pytest.fail(f"{command} is not installed")
            pytest.skip(f"{command} is not installed (set PG_DUMP_COMMAND / PG_RESTORE_COMMAND)")


@pytest.fixture
def source(database: str, tmp_path: Path) -> Iterator[tuple[str, Settings, str]]:
    """The three fixture activities and a signed-in browser. Yields (url, settings, cookie)."""
    settings = settings_for(tmp_path)
    store = LocalRawStore(settings.raw_dir)
    engine = create_engine(database)
    token, digest = new_token()
    with sessionmaker(engine).begin() as db:
        user = User(email="runner@example.com")
        db.add(user)
        db.flush()
        for name in ("run", "strength", "ride-power"):
            fit = (FIXTURES / "fit" / f"{name}.fit").read_bytes()
            ingest_fit(db, store, user_id=user.id, source="garmin", external_id=name, fit=fit)
        db.add(
            Device(
                user_id=user.id,
                name="Browser",
                platform="web",
                refresh_token_hash=digest,
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
    engine.dispose()
    yield database, settings, token


def test_backup_contents_and_incremental_files(source: tuple[str, Settings, str], tmp_path: Path) -> None:
    url, settings, _ = source
    destination = LocalObjectStore(tmp_path / "backups")
    first = run_backup(settings, destination, database_url=url, today=DAY)
    assert first.dump_key == "db/zankup-2026-11-08.dump" and first.dump_bytes > 10_000
    assert (first.raw_uploaded, first.raw_total) == (3, 3)
    keys = destination.sizes("")
    assert sum(k.startswith("raw/") and k.endswith(".fit") for k in keys) == 3
    manifest = json.loads(destination.get_bytes(MANIFEST))
    assert manifest["dump"] == first.dump_key and manifest["raw_files"] == 3

    second = run_backup(settings, destination, database_url=url, today=DAY + timedelta(days=1))
    assert second.raw_uploaded == 0  # originals never change: uploaded once


def test_old_dumps_are_deleted(source: tuple[str, Settings, str], tmp_path: Path) -> None:
    url, settings, _ = source
    settings = settings.model_copy(update={"backup_keep_days": 2})
    destination = LocalObjectStore(tmp_path / "backups")
    for offset in range(3):
        result = run_backup(settings, destination, database_url=url, today=DAY + timedelta(days=offset))
    assert result.dumps_deleted == 1
    assert sorted(destination.sizes("db/")) == [
        dump_key(DAY + timedelta(days=1)),
        dump_key(DAY + timedelta(days=2)),
    ]


def test_restore_into_a_fresh_database_and_the_app_works(
    source: tuple[str, Settings, str], tmp_path: Path
) -> None:
    url, settings, cookie = source
    destination = LocalObjectStore(tmp_path / "backups")
    run_backup(settings, destination, database_url=url, today=DAY)

    restored_dir = tmp_path / "restored"
    with throwaway_database() as fresh:
        key, files = restore(settings, destination, database_url=fresh, data_dir=restored_dir)
        assert key == dump_key(DAY) and files == 3

        engine = create_engine(fresh)
        sessions = sessionmaker(engine, expire_on_commit=False)
        with sessions() as db:
            assert db.scalar(select(func.count()).select_from(Activity)) == 3

        def session() -> Iterator[Session]:
            with sessions() as db:
                yield db

        restored = settings.model_copy(update={"data_dir": restored_dir})
        app = create_app(restored)
        app.dependency_overrides[get_session] = session
        app.dependency_overrides[get_settings] = lambda: restored
        app.dependency_overrides[get_engine] = lambda: engine
        app.dependency_overrides[get_store] = lambda: LocalRawStore(restored.raw_dir)
        http = TestClient(app)
        http.cookies.set(SESSION_COOKIE, cookie)  # the session came back with the database

        assert http.get("/api/health").json()["schema_revision"] is not None
        feed = http.get("/api/activities").json()["items"]
        assert len(feed) == 3
        run = next(item for item in feed if item["sport"] == "run")
        assert http.get(f"/api/activities/{run['id']}/streams").status_code == 200
        fit = http.get(f"/api/activities/{run['id']}/fit")
        assert fit.status_code == 200 and fit.content == (FIXTURES / "fit" / "run.fit").read_bytes()
        engine.dispose()


def test_a_corrupted_dump_is_refused(source: tuple[str, Settings, str], tmp_path: Path) -> None:
    url, settings, _ = source
    destination = LocalObjectStore(tmp_path / "backups")
    run_backup(settings, destination, database_url=url, today=DAY)
    destination.put_bytes(dump_key(DAY), b"not a dump")
    with pytest.raises(BackupError, match="SHA-256"):
        restore(settings, destination, database_url=url, data_dir=tmp_path / "restored")
    with pytest.raises(BackupError, match="no backup"):
        restore(settings, destination, database_url=url, data_dir=tmp_path / "x", day=date(2020, 1, 1))


def test_retention_reads_the_date_whatever_the_prefix(
    source: tuple[str, Settings, str], tmp_path: Path
) -> None:
    url, settings, _ = source
    destination = LocalObjectStore(tmp_path / "backups")
    destination.put_bytes("db/earlier-name-2026-11-01.dump", b"old")  # made before the rename
    destination.put_bytes("db/earlier-name-2026-11-07.dump", b"recent")
    run_backup(settings.model_copy(update={"backup_keep_days": 3}), destination, database_url=url, today=DAY)
    assert sorted(destination.sizes("db/")) == ["db/earlier-name-2026-11-07.dump", dump_key(DAY)]
