"""Engine and sessions."""

from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from opensport.core.config import get_settings


@lru_cache
def get_engine() -> Engine:
    # Short connect timeout: the health check must answer quickly even when Postgres is down.
    return create_engine(
        get_settings().sqlalchemy_url, pool_pre_ping=True, connect_args={"connect_timeout": 3}
    )


def get_session() -> Iterator[Session]:
    """FastAPI dependency: one session per request, closed afterwards."""
    with sessionmaker(get_engine(), expire_on_commit=False)() as session:
        yield session


def database_status(engine: Engine) -> tuple[bool, str | None]:
    """(reachable, current Alembic revision). The revision is None before the first migration."""
    try:
        with engine.connect() as conn:
            exists = conn.scalar(text("SELECT to_regclass('alembic_version') IS NOT NULL"))
            revision = conn.scalar(text("SELECT version_num FROM alembic_version")) if exists else None
            return True, revision
    except SQLAlchemyError:
        return False, None
