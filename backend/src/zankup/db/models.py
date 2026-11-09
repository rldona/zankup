"""Database model (see docs/architecture.md, "Data model").

Every user-owned table carries `user_id` and every query must filter by it, even though each instance
has a single user: it keeps a hosted, multi-user version possible without a data migration.
Enumerated values are plain text with CHECK constraints, which are simpler to evolve than Postgres enums.
"""

from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
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

from zankup.db.base import Base, Timestamps

SOURCES = ("garmin", "strava", "file")
SOURCE_KINDS = ("garmin", "google_health", "strava", "file")
PLATFORMS = ("web", "android")
SYNC_TRIGGERS = ("cron", "button", "initial", "import")
SYNC_STATUSES = ("queued", "running", "success", "error")
JOB_STATUSES = ("queued", "running", "done", "failed")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def _user_fk() -> Mapped[int]:
    return mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)


class User(Timestamps, Base):
    """The owner of the instance. Sign-in methods arrive with authentication (OS-110)."""

    __tablename__ = "users"
    __table_args__ = (CheckConstraint("sex IN ('female', 'male', 'other')", name="sex"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    display_name: Mapped[str | None] = mapped_column(String(120))
    password_hash: Mapped[str | None] = mapped_column(String(255), comment="Argon2id")
    totp_secret_enc: Mapped[str | None] = mapped_column(
        Text, comment="Encrypted with a key derived from JWT_SECRET"
    )
    totp_enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    totp_last_counter: Mapped[int | None] = mapped_column(
        BigInteger, comment="Last accepted step: no replays"
    )
    google_sub: Mapped[str | None] = mapped_column(
        String(255), unique=True, comment="Linked Google account (OS-220): only this one can sign in"
    )
    # Profile (OS-218): optional, used by the metrics engine (age, weight) and shown on the profile.
    location: Mapped[str | None] = mapped_column(String(120))
    birth_date: Mapped[date | None] = mapped_column(Date)
    sex: Mapped[str | None] = mapped_column(String(10))
    weight_kg: Mapped[float | None] = mapped_column(Float)
    height_cm: Mapped[int | None] = mapped_column(SmallInteger)


class UserSettings(Timestamps, Base):
    """Preferences and physiological settings. The metrics engine recomputes when these change."""

    __tablename__ = "settings"
    __table_args__ = (
        CheckConstraint("language IN ('en', 'es')", name="language"),
        CheckConstraint("units IN ('metric', 'imperial')", name="units"),
    )

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    language: Mapped[str | None] = mapped_column(
        String(5), comment="Null until the user picks one: the browser's language is used"
    )
    units: Mapped[str] = mapped_column(String(10), server_default="metric")
    theme: Mapped[str] = mapped_column(String(20), server_default="system")
    hr_max: Mapped[int | None] = mapped_column(SmallInteger)
    hr_rest: Mapped[int | None] = mapped_column(SmallInteger)
    lthr: Mapped[int | None] = mapped_column(SmallInteger)
    ftp: Mapped[int | None] = mapped_column(SmallInteger)
    zone_model: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    privacy_zones: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)


class Device(Timestamps, Base):
    """A signed-in client (browser or Android app): its session and its push endpoint.

    The browser keeps an opaque session token in an httpOnly cookie and the app a refresh token; only
    their SHA-256 is stored here. Deleting the row signs that client out (revocable from Settings).
    """

    __tablename__ = "devices"
    __table_args__ = (CheckConstraint(_in("platform", PLATFORMS), name="platform"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    name: Mapped[str] = mapped_column(String(120))
    platform: Mapped[str] = mapped_column(String(10))
    push_endpoint: Mapped[str | None] = mapped_column(Text)
    refresh_token_hash: Mapped[str | None] = mapped_column(String(128), unique=True)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SetupCode(Base):
    """The one-time code that allows creating the instance's account (OS-221). It exists only while
    sign-up is open, is written to the server logs on every start, and is deleted when sign-up ends."""

    __tablename__ = "setup_codes"

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    code_hash: Mapped[str] = mapped_column(String(64))
    code_enc: Mapped[str] = mapped_column(
        Text, comment="Encrypted with JWT_SECRET, to show it again in the logs"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RecoveryCode(Base):
    """A single-use code that replaces the TOTP code when the phone is lost (OS-221, OS-222)."""

    __tablename__ = "recovery_codes"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    code_hash: Mapped[str] = mapped_column(String(64), unique=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PasswordReset(Base):
    """A password recovery link (OS-222): single use, 30 minutes. Only the token's SHA-256 is kept."""

    __tablename__ = "password_resets"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Passkey(Base):
    """A WebAuthn credential (OS-405): signs in without password or TOTP, since the device already checks
    the fingerprint, face or PIN. Bound to the instance's domain (WEBAUTHN_RP_ID)."""

    __tablename__ = "passkeys"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    credential_id: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    public_key: Mapped[bytes] = mapped_column(LargeBinary, comment="COSE public key")
    sign_count: Mapped[int] = mapped_column(BigInteger, server_default="0")
    transports: Mapped[list[str] | None] = mapped_column(JSONB)
    aaguid: Mapped[str | None] = mapped_column(
        String(36), comment="Authenticator model, e.g. Google Password Manager"
    )
    backed_up: Mapped[bool] = mapped_column(server_default="false", comment="Synced by a password manager")
    name: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WebAuthnChallenge(Base):
    """A challenge handed to the browser, used once: deleted when the response comes back or expires."""

    __tablename__ = "webauthn_challenges"
    __table_args__ = (CheckConstraint("purpose IN ('register', 'login')", name="purpose"),)

    challenge: Mapped[bytes] = mapped_column(LargeBinary, primary_key=True)
    purpose: Mapped[str] = mapped_column(String(10))
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Activity(Timestamps, Base):
    """One activity, from its original file. Everything here can be recomputed from that file."""

    __tablename__ = "activities"
    __table_args__ = (
        UniqueConstraint("user_id", "source", "external_id"),
        CheckConstraint(_in("source", SOURCES), name="source"),
        Index("ix_activities_user_start", "user_id", "start_utc"),
        Index("ix_activities_user_sport_start", "user_id", "sport", "start_utc"),
        Index("ix_activities_user_distance", "user_id", "distance_m"),
        # Full-text search (OS-219) uses ix_activities_search, an expression index created in its
        # migration: see zankup_search_text there.
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
    splits: Mapped[list[dict[str, Any]] | None] = mapped_column(
        JSONB, comment="Per-km splits: distance_m, time_s, elevation_change_m, avg_hr"
    )
    sets: Mapped[list[dict[str, Any]] | None] = mapped_column(
        JSONB, comment="Strength sets (OS-225): start_s, duration_s, kind, reps, weight_kg, category"
    )
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


class BestEffort(Base):
    """Fastest time over a standard distance within one activity (OS-107). Records come from here."""

    __tablename__ = "best_efforts"
    __table_args__ = (Index("ix_best_efforts_user_distance_time", "user_id", "distance_key", "time_s"),)

    activity_id: Mapped[int] = mapped_column(
        ForeignKey("activities.id", ondelete="CASCADE"), primary_key=True
    )
    distance_key: Mapped[str] = mapped_column(
        String(20), primary_key=True, comment="e.g. 1k, 5k, half_marathon"
    )
    user_id: Mapped[int] = _user_fk()
    distance_m: Mapped[float] = mapped_column(Float)
    time_s: Mapped[float] = mapped_column(Float)
    start_s: Mapped[float] = mapped_column(Float, comment="Seconds from the start of the activity")
    start_distance_m: Mapped[float] = mapped_column(Float)


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


class Job(Base):
    """A unit of background work (OS-115). Claimed with SELECT … FOR UPDATE SKIP LOCKED."""

    __tablename__ = "jobs"
    __table_args__ = (
        CheckConstraint(_in("status", JOB_STATUSES), name="status"),
        Index("ix_jobs_status_run_after", "status", "run_after"),
        UniqueConstraint("dedupe_key"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    kind: Mapped[str] = mapped_column(String(50))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default="{}")
    status: Mapped[str] = mapped_column(String(10), server_default="queued")
    run_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    attempts: Mapped[int] = mapped_column(SmallInteger, server_default="0")
    max_attempts: Mapped[int] = mapped_column(SmallInteger, server_default="5")
    dedupe_key: Mapped[str | None] = mapped_column(String(200), comment="Skips enqueuing the same work twice")
    last_error: Mapped[str | None] = mapped_column(Text)
    locked_by: Mapped[str | None] = mapped_column(String(100))
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# --- Metrics engine (phase 3) ------------------------------------------------------------------------


class ActivityMetrics(Base):
    """What the engine computes per activity (OS-313): effort, zones, curves, GAP, calories, route."""

    __tablename__ = "activity_metrics"
    __table_args__ = (Index("ix_activity_metrics_user_route", "user_id", "route_group"),)

    activity_id: Mapped[int] = mapped_column(
        ForeignKey("activities.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = _user_fk()
    metrics_version: Mapped[int] = mapped_column(SmallInteger)
    trimp: Mapped[float | None] = mapped_column(Float, comment="Banister TRIMP (relative effort)")
    hr_zones: Mapped[list[float] | None] = mapped_column(JSONB, comment="Seconds per HR zone")
    power_zones: Mapped[list[float] | None] = mapped_column(JSONB, comment="Seconds per power zone")
    gap_distance_m: Mapped[float | None] = mapped_column(Float, comment="Grade-adjusted distance")
    calories: Mapped[float | None] = mapped_column(Float, comment="Estimated kcal (the device's wins)")
    efficiency: Mapped[float | None] = mapped_column(Float, comment="Speed (m/min) per bpm")
    decoupling: Mapped[float | None] = mapped_column(Float, comment="Pa:HR drift, %")
    power_curve: Mapped[dict[str, float] | None] = mapped_column(JSONB, comment="Best watts per duration (s)")
    speed_curve: Mapped[dict[str, float] | None] = mapped_column(JSONB, comment="Best m/s per duration (s)")
    hr_curve: Mapped[dict[str, float] | None] = mapped_column(
        JSONB, comment="Best average HR per duration (s)"
    )
    route_group: Mapped[int | None] = mapped_column(
        BigInteger, comment="Matched routes (OS-309): the first activity of the group"
    )
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DailyLoad(Base):
    """Fitness, fatigue and form per day (OS-303), from the activities' TRIMP."""

    __tablename__ = "daily_load"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    load: Mapped[float] = mapped_column(Float)
    ctl: Mapped[float] = mapped_column(Float)
    atl: Mapped[float] = mapped_column(Float)
    tsb: Mapped[float] = mapped_column(Float)


class EstimateRow(Base):
    """A performance estimate on a day (OS-316): value, method and the activities it comes from."""

    __tablename__ = "estimates"
    __table_args__ = (UniqueConstraint("user_id", "kind", "day"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    kind: Mapped[str] = mapped_column(String(30), comment="ftp, critical_speed, lthr, hr_max, vdot, race_5k…")
    day: Mapped[date] = mapped_column(Date)
    value: Mapped[float] = mapped_column(Float)
    method: Mapped[str] = mapped_column(String(120))
    source_activity_ids: Mapped[list[int]] = mapped_column(JSONB, server_default="[]")
    metrics_version: Mapped[int] = mapped_column(SmallInteger)


class Event(Base):
    """Something the engine noticed (OS-319): a record, an estimate going up, a risky load ramp."""

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    kind: Mapped[str] = mapped_column(String(30), comment="record, estimate_up, ramp")
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    dedupe_key: Mapped[str] = mapped_column(String(200), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Goal(Base):
    """A volume goal (OS-318): so much distance, time or activities per week, month or year."""

    __tablename__ = "goals"
    __table_args__ = (
        CheckConstraint("period IN ('week', 'month', 'year')", name="period"),
        CheckConstraint("metric IN ('distance', 'time', 'count')", name="metric"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    period: Mapped[str] = mapped_column(String(10))
    metric: Mapped[str] = mapped_column(String(10))
    sport: Mapped[str | None] = mapped_column(String(20))
    target: Mapped[float] = mapped_column(Float, comment="Metres, seconds or a count")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Segment(Base):
    """A stretch saved from an activity (OS-325), found in every activity that goes through it."""

    __tablename__ = "segments"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    name: Mapped[str] = mapped_column(String(120))
    track: Mapped[str] = mapped_column(Text, comment="Encoded polyline (precision 6)")
    distance_m: Mapped[float] = mapped_column(Float)
    ascent_m: Mapped[float | None] = mapped_column(Float)
    source_activity_id: Mapped[int | None] = mapped_column(ForeignKey("activities.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SegmentEffort(Base):
    __tablename__ = "segment_efforts"
    __table_args__ = (UniqueConstraint("segment_id", "activity_id"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    segment_id: Mapped[int] = mapped_column(ForeignKey("segments.id", ondelete="CASCADE"), index=True)
    activity_id: Mapped[int] = mapped_column(ForeignKey("activities.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = _user_fk()
    start_s: Mapped[float] = mapped_column(Float)
    elapsed_s: Mapped[float] = mapped_column(Float)
    avg_hr: Mapped[int | None] = mapped_column(SmallInteger)
    avg_power: Mapped[int | None] = mapped_column(SmallInteger)


class EngineRun(Base):
    """A full recomputation (OS-314), so the app can show its progress."""

    __tablename__ = "engine_runs"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    status: Mapped[str] = mapped_column(String(10), server_default="running")
    reason: Mapped[str] = mapped_column(String(60))
    total: Mapped[int] = mapped_column(Integer, server_default="0")
    done: Mapped[int] = mapped_column(Integer, server_default="0")
    metrics_version: Mapped[int] = mapped_column(SmallInteger)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)
