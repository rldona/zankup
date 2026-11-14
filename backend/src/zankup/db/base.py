"""Declarative base, naming convention and shared column helpers."""

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Engine, MetaData, event, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Stable constraint names, so Alembic migrations are deterministic across databases.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


@event.listens_for(Engine, "connect")
def _utc(dbapi_connection: Any, _record: Any) -> None:
    """Every connection in UTC, whatever the server's timezone: times come back as UTC, so adding an
    activity's offset gives its local hour and day (a server in Europe/Madrid gave them an hour late).
    Committed, so the pool's rollback on return does not undo it."""
    with dbapi_connection.cursor() as cursor:
        cursor.execute("SET TIME ZONE 'UTC'")
    if not getattr(dbapi_connection, "autocommit", False):
        dbapi_connection.commit()


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class Timestamps:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
