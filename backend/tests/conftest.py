"""Shared fixtures. Database tests run against a throwaway database on DATABASE_URL's server.

Locally they are skipped when Postgres is not running (`make db` starts it); in CI, REQUIRE_DB=1 makes
a missing database an error instead of a skip.
"""

import os
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError, ProgrammingError

from zankup.core.config import Settings

ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"


def alembic_config(url: str) -> Config:
    config = Config(str(ALEMBIC_INI))
    config.attributes["sqlalchemy_url"] = url
    return config


@contextmanager
def throwaway_database() -> Iterator[str]:
    """Create a new, empty database and drop it afterwards. Yields its SQLAlchemy URL."""
    server = make_url(Settings(_env_file=None).sqlalchemy_url)  # type: ignore[call-arg]
    admin = create_engine(server, isolation_level="AUTOCOMMIT")
    name = f"zankup_test_{uuid.uuid4().hex[:12]}"
    try:
        with admin.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{name}"'))
    except OperationalError as error:
        if os.environ.get("REQUIRE_DB") == "1":
            raise
        pytest.skip(f"Postgres not available ({error.orig.__class__.__name__}); run `make db`")
    try:
        yield server.set(database=name).render_as_string(hide_password=False)
    finally:
        # FORCE cannot end an autovacuum worker on it (a superuser's process) without
        # pg_signal_autovacuum_worker: it finishes in a moment, so try again.
        for attempt in range(10):
            try:
                with admin.connect() as conn:
                    conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
                break
            except ProgrammingError:
                if attempt == 9:
                    raise
                time.sleep(0.5)
        admin.dispose()


@pytest.fixture
def empty_database() -> Iterator[str]:
    """A new, empty database, dropped after the test. Yields its SQLAlchemy URL."""
    with throwaway_database() as url:
        yield url


@pytest.fixture
def database(empty_database: str) -> str:
    """A new database migrated to the latest revision."""
    command.upgrade(alembic_config(empty_database), "head")
    return empty_database


@pytest.fixture(autouse=True)
def _fresh_instance_keys() -> Iterator[None]:
    """Each test starts with no cached service keys (zankup.instance_keys caches for a few seconds)."""
    from zankup import instance_keys

    instance_keys.forget()
    yield
    instance_keys.forget()
