"""Database model (see docs/architecture.md, "Data model").

Every user-owned table carries `user_id` and every query must filter by it, even though each instance
has a single user: it keeps a hosted, multi-user version possible without a data migration.
Enumerated values are plain text with CHECK constraints, which are simpler to evolve than Postgres enums.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Identity,
    Index,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from opensport.db.base import Base, Timestamps

SOURCES = ("garmin", "strava", "file")
SOURCE_KINDS = ("garmin", "google_health", "strava", "file")
PLATFORMS = ("web", "android")
SYNC_TRIGGERS = ("cron", "button", "initial", "import")
SYNC_STATUSES = ("running", "success", "error")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def _user_fk() -> Mapped[int]:
    return mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)


class User(Timestamps, Base):
    """The owner of the instance. Sign-in methods arrive with authentication (OS-110)."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    display_name: Mapped[str | None] = mapped_column(String(120))


class UserSettings(Timestamps, Base):
    """Preferences and physiological settings. The metrics engine recomputes when these change."""

    __tablename__ = "settings"
    __table_args__ = (
        CheckConstraint("language IN ('en', 'es')", name="language"),
        CheckConstraint("units IN ('metric', 'imperial')", name="units"),
    )

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    language: Mapped[str] = mapped_column(String(5), server_default="en")
    units: Mapped[str] = mapped_column(String(10), server_default="metric")
    theme: Mapped[str] = mapped_column(String(20), server_default="system")
    hr_max: Mapped[int | None] = mapped_column(SmallInteger)
    hr_rest: Mapped[int | None] = mapped_column(SmallInteger)
    lthr: Mapped[int | None] = mapped_column(SmallInteger)
    ftp: Mapped[int | None] = mapped_column(SmallInteger)
    zone_model: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    privacy_zones: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)


class Device(Timestamps, Base):
    """A signed-in client (browser or Android app) with its push endpoint. Revocable from Settings."""

    __tablename__ = "devices"
    __table_args__ = (CheckConstraint(_in("platform", PLATFORMS), name="platform"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    name: Mapped[str] = mapped_column(String(120))
    platform: Mapped[str] = mapped_column(String(10))
    push_endpoint: Mapped[str | None] = mapped_column(Text)
    refresh_token_hash: Mapped[str | None] = mapped_column(String(128), unique=True)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Activity(Timestamps, Base):
    """One activity, from its original file. Everything here can be recomputed from that file."""

    __tablename__ = "activities"
    __table_args__ = (
        UniqueConstraint("user_id", "source", "external_id"),
        CheckConstraint(_in("source", SOURCES), name="source"),
        Index("ix_activities_user_start", "user_id", "start_utc"),
        Index("ix_activities_user_sport_start", "user_id", "sport", "start_utc"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    source: Mapped[str] = mapped_column(String(10))
    external_id: Mapped[str] = mapped_column(String(64), comment="Garmin activityId, Strava ID or file hash")
    name: Mapped[str | None] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    sport: Mapped[str] = mapped_column(String(20))
    sub_sport: Mapped[str | None] = mapped_column(String(40))
    start_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    timezone: Mapped[str | None] = mapped_column(String(64))
    duration_s: Mapped[float] = mapped_column(Float)
    moving_s: Mapped[float | None] = mapped_column(Float)
    distance_m: Mapped[float | None] = mapped_column(Float)
    ascent_m: Mapped[float | None] = mapped_column(Float)
    descent_m: Mapped[float | None] = mapped_column(Float)
    avg_hr: Mapped[int | None] = mapped_column(SmallInteger)
    max_hr: Mapped[int | None] = mapped_column(SmallInteger)
    avg_power: Mapped[int | None] = mapped_column(SmallInteger)
    normalized_power: Mapped[int | None] = mapped_column(SmallInteger)
    calories: Mapped[int | None] = mapped_column(Integer)
    training_effect: Mapped[float | None] = mapped_column(Float)
    device: Mapped[str | None] = mapped_column(String(120))
    fit_path: Mapped[str | None] = mapped_column(String(255), comment="Relative to DATA_DIR/raw")
    fit_sha256: Mapped[str | None] = mapped_column(String(64))
    has_gps: Mapped[bool] = mapped_column(server_default="false")
    bbox: Mapped[list[float] | None] = mapped_column(JSONB, comment="[min_lat, min_lon, max_lat, max_lon]")
    route_simplified: Mapped[str | None] = mapped_column(Text, comment="Encoded polyline for thumbnails")
    raw_meta: Mapped[dict[str, Any] | None] = mapped_column(JSONB, comment="Source metadata, as received")
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Lap(Base):
    __tablename__ = "laps"

    activity_id: Mapped[int] = mapped_column(
        ForeignKey("activities.id", ondelete="CASCADE"), primary_key=True
    )
    idx: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    user_id: Mapped[int] = _user_fk()
    start_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration_s: Mapped[float] = mapped_column(Float)
    distance_m: Mapped[float | None] = mapped_column(Float)
    avg_hr: Mapped[int | None] = mapped_column(SmallInteger)
    max_hr: Mapped[int | None] = mapped_column(SmallInteger)
    avg_power: Mapped[int | None] = mapped_column(SmallInteger)
    ascent_m: Mapped[float | None] = mapped_column(Float)
    descent_m: Mapped[float | None] = mapped_column(Float)


class Stream(Base):
    """The 1 Hz series of an activity, compressed (OS-106 defines the encoding)."""

    __tablename__ = "streams"

    activity_id: Mapped[int] = mapped_column(
        ForeignKey("activities.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = _user_fk()
    encoding: Mapped[str] = mapped_column(String(20), comment="e.g. json+gzip")
    series: Mapped[list[str]] = mapped_column(JSONB, comment="Series present: lat, lon, dist, alt, hr…")
    sample_count: Mapped[int] = mapped_column(Integer)
    data: Mapped[bytes] = mapped_column(LargeBinary)


class SyncRun(Base):
    __tablename__ = "sync_runs"
    __table_args__ = (
        CheckConstraint(_in("trigger", SYNC_TRIGGERS), name="trigger"),
        CheckConstraint(_in("status", SYNC_STATUSES), name="status"),
        Index("ix_sync_runs_user_started", "user_id", "started_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    trigger: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(10), server_default="running")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    new_count: Mapped[int] = mapped_column(Integer, server_default="0")
    progress: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)


class Source(Timestamps, Base):
    """A connected data source and its sync state.

    `access_token` holds short-lived tokens only (Garmin's lasts 24 h). Long-lived credentials such as
    OAuth refresh tokens (OS-603) must be stored encrypted.
    """

    __tablename__ = "sources"
    __table_args__ = (
        UniqueConstraint("user_id", "kind"),
        CheckConstraint(_in("kind", SOURCE_KINDS), name="kind"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    kind: Mapped[str] = mapped_column(String(20))
    access_token: Mapped[str | None] = mapped_column(Text)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sync_cursor: Mapped[dict[str, Any] | None] = mapped_column(JSONB, comment="Source-specific sync state")
