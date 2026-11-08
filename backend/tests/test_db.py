from datetime import UTC, datetime

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, func, inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tests.conftest import alembic_config
from zankup.db import Activity, Base, Lap, Stream, User, UserSettings

TABLES = {"users", "settings", "devices", "activities", "laps", "streams", "sync_runs"}


def test_migrations_round_trip(empty_database: str) -> None:
    config = alembic_config(empty_database)
    command.upgrade(config, "head")
    command.downgrade(config, "base")
    command.upgrade(config, "head")
    engine = create_engine(empty_database)
    assert set(inspect(engine).get_table_names()) >= TABLES
    engine.dispose()


def test_models_match_migrations(database: str) -> None:
    engine = create_engine(database)
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn, opts={"compare_type": True}), Base.metadata)
    engine.dispose()
    assert diff == [], "Models changed without a migration: run `make migration m='…'`"


def test_every_user_owned_table_has_user_id() -> None:
    for name in TABLES - {"users"}:
        assert "user_id" in Base.metadata.tables[name].c, name


def _activity(user: User, external_id: str = "1", source: str = "garmin") -> Activity:
    return Activity(
        user_id=user.id,
        source=source,
        external_id=external_id,
        sport="run",
        start_utc=datetime(2020, 1, 11, 17, 47, 49, tzinfo=UTC),
        duration_s=2253.0,
        distance_m=6022.0,
    )


def test_activity_lifecycle(database: str) -> None:
    engine = create_engine(database)
    with Session(engine) as session:
        user = User(email="runner@example.com")
        session.add(user)
        session.flush()
        session.add(UserSettings(user_id=user.id))
        activity = _activity(user)
        session.add(activity)
        session.flush()
        session.add(
            Lap(activity_id=activity.id, idx=0, user_id=user.id, start_utc=activity.start_utc, duration_s=340)
        )
        session.add(
            Stream(
                activity_id=activity.id,
                user_id=user.id,
                encoding="json+gzip",
                series=["hr"],
                sample_count=1,
                data=b"\x1f\x8b",
            )
        )
        session.commit()

        settings = session.get(UserSettings, user.id)
        assert settings is not None and settings.language == "en" and settings.units == "metric"
        assert activity.imported_at is not None and activity.has_gps is False

        # Deleting the user removes everything they own.
        session.delete(user)
        session.commit()
        for model in (Activity, Lap, Stream, UserSettings):
            assert session.scalar(select(func.count()).select_from(model)) == 0
    engine.dispose()


@pytest.mark.parametrize("problem", ["duplicate", "bad_source"])
def test_constraints(database: str, problem: str) -> None:
    engine = create_engine(database)
    with Session(engine) as session:
        user = User(email="runner@example.com")
        session.add(user)
        session.flush()
        session.add(_activity(user))
        session.flush()
        session.add(_activity(user) if problem == "duplicate" else _activity(user, "2", source="polar"))
        with pytest.raises(IntegrityError):
            session.flush()
    engine.dispose()
