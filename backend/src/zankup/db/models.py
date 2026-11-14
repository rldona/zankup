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
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from zankup.db.base import Base, Timestamps

SOURCES = ("garmin", "strava", "file")
SOURCE_KINDS = ("garmin", "google_health", "health_connect", "strava", "file")
# Where health data comes from (OS-601), and what is kept from each one.
HEALTH_SOURCES = ("garmin", "google_health", "health_connect")
HEALTH_METRICS = ("sleep", "resting_hr", "hrv", "spo2", "respiration", "steps")
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
    avatar_url: Mapped[str | None] = mapped_column(String(500), comment="Linked Google photo")
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
    privacy_zones: Mapped[list[dict[str, Any]] | None] = mapped_column(
        JSONB, comment="Hidden in anything shared (OS-407): [{id, name, lat, lon, radius_m}]"
    )
    notifications: Mapped[dict[str, bool] | None] = mapped_column(
        JSONB, comment="Which push notifications to send (OS-402); missing keys use the defaults"
    )
    ai: Mapped[dict[str, bool] | None] = mapped_column(
        JSONB, comment="Which AI features are on (OS-708); missing keys use the defaults"
    )


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
    strava: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB,
        comment="From a Strava export (OS-406): id, Strava's own effort, calories and grade-adjusted "
        "distance (references for OS-323) and the weather",
    )
    gear_id: Mapped[int | None] = mapped_column(ForeignKey("gear.id", ondelete="SET NULL"), index=True)
    edited_fields: Mapped[list[str] | None] = mapped_column(
        JSONB, comment="Fields the user edited (OS-409): reprocessing and imports never overwrite them"
    )
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

    `access_token` holds short-lived tokens only (Garmin's lasts 24 h, Google's 1 h). Long-lived
    credentials such as OAuth refresh tokens (OS-603) go in `secret`, encrypted.
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
    secret: Mapped[bytes | None] = mapped_column(
        LargeBinary, comment="Long-lived credential (an OAuth refresh token), encrypted: zankup.health.crypto"
    )


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
    hr_zones: Mapped[list[float] | None] = mapped_column(
        JSONB(none_as_null=True), comment="Seconds per HR zone"
    )
    power_zones: Mapped[list[float] | None] = mapped_column(
        JSONB(none_as_null=True), comment="Seconds per power zone"
    )
    gap_distance_m: Mapped[float | None] = mapped_column(Float, comment="Grade-adjusted distance")
    calories: Mapped[float | None] = mapped_column(Float, comment="Estimated kcal (the device's wins)")
    efficiency: Mapped[float | None] = mapped_column(Float, comment="Speed (m/min) per bpm")
    decoupling: Mapped[float | None] = mapped_column(Float, comment="Pa:HR drift, %")
    power_curve: Mapped[dict[str, float] | None] = mapped_column(
        JSONB(none_as_null=True), comment="Best watts per duration (s)"
    )
    speed_curve: Mapped[dict[str, float] | None] = mapped_column(
        JSONB(none_as_null=True), comment="Best m/s per duration (s)"
    )
    hr_curve: Mapped[dict[str, float] | None] = mapped_column(
        JSONB(none_as_null=True), comment="Best average HR per duration (s)"
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
    method: Mapped[str] = mapped_column(String(120))  # a key such as ftp_20min or riegel:10
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
    """A volume goal (OS-318): so much distance, time, elevation or activities per week, month or year."""

    __tablename__ = "goals"
    __table_args__ = (
        CheckConstraint("period IN ('week', 'month', 'year')", name="period"),
        CheckConstraint("metric IN ('distance', 'time', 'ascent', 'count')", name="metric"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    period: Mapped[str] = mapped_column(String(10))
    metric: Mapped[str] = mapped_column(String(10))
    sport: Mapped[str | None] = mapped_column(String(20))
    target: Mapped[float] = mapped_column(Float, comment="Metres, seconds, metres climbed or a count")
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


GEAR_KINDS = ("shoe", "bike", "other")
IMPORT_STATUSES = ("uploading", "queued", "running", "done", "error")
EXPORT_STATUSES = ("queued", "running", "done", "error")


class Gear(Timestamps, Base):
    """Shoes and bikes (OS-410). Mileage is the sum of the activities using it plus `initial_m`."""

    __tablename__ = "gear"
    __table_args__ = (
        CheckConstraint(_in("kind", GEAR_KINDS), name="kind"),
        UniqueConstraint("user_id", "name"),
        # One habitual pair of shoes, one habitual bike…: at most one per kind.
        Index(
            "uq_gear_habitual_kind",
            "user_id",
            "kind",
            unique=True,
            postgresql_where=text("habitual"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    kind: Mapped[str] = mapped_column(String(10))
    name: Mapped[str] = mapped_column(String(120))
    brand: Mapped[str | None] = mapped_column(String(120))
    model: Mapped[str | None] = mapped_column(String(120))
    sports: Mapped[list[str] | None] = mapped_column(
        JSONB, comment="Sports it is the default for: new activities of these sports get it"
    )
    initial_m: Mapped[float] = mapped_column(Float, server_default="0")
    limit_m: Mapped[float | None] = mapped_column(Float, comment="Warn when the mileage passes it")
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    strava_id: Mapped[str | None] = mapped_column(String(32))
    habitual: Mapped[bool] = mapped_column(
        server_default="false",
        comment="The one of its kind used most: highlighted, and preferred for new activities",
    )


class Photo(Base):
    """A photo of an activity (OS-412), stored re-encoded without EXIF under DATA_DIR/photos."""

    __tablename__ = "photos"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    activity_id: Mapped[int] = mapped_column(ForeignKey("activities.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(255), unique=True)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    caption: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(10), server_default="upload")
    source_name: Mapped[str | None] = mapped_column(String(255), comment="File name in the Strava export")
    position: Mapped[int] = mapped_column(SmallInteger, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PushSubscription(Base):
    """A browser's Web Push subscription (OS-401)."""

    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    endpoint: Mapped[str] = mapped_column(Text, unique=True)
    p256dh: Mapped[str] = mapped_column(String(200))
    auth: Mapped[str] = mapped_column(String(100))
    name: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failures: Mapped[int] = mapped_column(SmallInteger, server_default="0")


class ShareLink(Base):
    """A public, expiring link to one activity (OS-408). Only the token's SHA-256 is stored."""

    __tablename__ = "share_links"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    activity_id: Mapped[int] = mapped_column(ForeignKey("activities.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    show_map: Mapped[bool] = mapped_column(server_default="true")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    views: Mapped[int] = mapped_column(Integer, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ImportRow(Base):
    """An uploaded file or archive and its import (OS-404, OS-406)."""

    __tablename__ = "imports"
    __table_args__ = (CheckConstraint(_in("status", IMPORT_STATUSES), name="status"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    kind: Mapped[str | None] = mapped_column(String(10), comment="strava, archive or file, once read")
    status: Mapped[str] = mapped_column(String(10), server_default="uploading")
    filename: Mapped[str] = mapped_column(String(255))
    size: Mapped[int] = mapped_column(BigInteger)
    received: Mapped[int] = mapped_column(BigInteger, server_default="0")
    total: Mapped[int] = mapped_column(Integer, server_default="0")
    processed: Mapped[int] = mapped_column(Integer, server_default="0")
    created: Mapped[int] = mapped_column(Integer, server_default="0")
    merged: Mapped[int] = mapped_column(Integer, server_default="0")
    skipped: Mapped[int] = mapped_column(Integer, server_default="0")
    failed: Mapped[int] = mapped_column(Integer, server_default="0")
    photos: Mapped[int] = mapped_column(Integer, server_default="0")
    errors: Mapped[list[dict[str, str]] | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ExportRow(Base):
    """A ZIP with all of a user's data (OS-411), kept for a few days under DATA_DIR/exports."""

    __tablename__ = "exports"
    __table_args__ = (CheckConstraint(_in("status", EXPORT_STATUSES), name="status"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    status: Mapped[str] = mapped_column(String(10), server_default="queued")
    path: Mapped[str | None] = mapped_column(String(255))
    size: Mapped[int | None] = mapped_column(BigInteger)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# --- health (phase 6) --------------------------------------------------------------------------------


class SleepSession(Timestamps, Base):
    """One sleep from one source (OS-601). Several sources can record the same night: they are all
    kept, and the dashboard picks one per night (zankup.health.resolve, OS-605).

    `day` is the local date the person woke up on. `stages` is a compact list of
    `[seconds from start, duration in seconds, stage]` with stage one of awake, light, deep, rem.
    `score` is Zankup's own (zankup.health.sleep_score), the same for every source.
    """

    __tablename__ = "sleep_sessions"
    __table_args__ = (
        UniqueConstraint("user_id", "source", "external_id"),
        CheckConstraint(_in("source", HEALTH_SOURCES), name="source"),
        Index("ix_sleep_sessions_user_id_day", "user_id", "day"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    source: Mapped[str] = mapped_column(String(20))
    external_id: Mapped[str] = mapped_column(String(128))
    origin: Mapped[str | None] = mapped_column(
        String(120), comment="The app or device that recorded it, when the source says (Health Connect)"
    )
    day: Mapped[date] = mapped_column(Date)
    start_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    utc_offset_s: Mapped[int | None] = mapped_column(Integer)
    nap: Mapped[bool] = mapped_column(default=False, server_default="false")
    asleep_s: Mapped[int | None] = mapped_column(Integer)
    awake_s: Mapped[int | None] = mapped_column(Integer)
    light_s: Mapped[int | None] = mapped_column(Integer)
    deep_s: Mapped[int | None] = mapped_column(Integer)
    rem_s: Mapped[int | None] = mapped_column(Integer)
    score: Mapped[int | None] = mapped_column(SmallInteger)
    stages: Mapped[list[Any] | None] = mapped_column(JSONB)


class DailyHealth(Timestamps, Base):
    """One day's figures from one source (OS-601): resting HR, overnight HRV (RMSSD), SpO₂,
    respiration and steps. `wear_s` is how long the source measured heart rate that day, used to
    choose between sources (OS-605)."""

    __tablename__ = "daily_health"
    __table_args__ = (
        UniqueConstraint("user_id", "source", "day"),
        CheckConstraint(_in("source", HEALTH_SOURCES), name="source"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    source: Mapped[str] = mapped_column(String(20))
    external_id: Mapped[str] = mapped_column(String(128))
    day: Mapped[date] = mapped_column(Date)
    resting_hr: Mapped[float | None] = mapped_column(Float)
    hrv_ms: Mapped[float | None] = mapped_column(Float)
    spo2: Mapped[float | None] = mapped_column(Float)
    respiration: Mapped[float | None] = mapped_column(Float)
    steps: Mapped[int | None] = mapped_column(Integer)
    wear_s: Mapped[int | None] = mapped_column(Integer)


class SourcePriority(Base):
    """The person's order of sources for one metric (OS-605). Without a row, the automatic rules apply."""

    __tablename__ = "source_priority"
    __table_args__ = (CheckConstraint(_in("metric", HEALTH_METRICS), name="metric"),)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    metric: Mapped[str] = mapped_column(String(20), primary_key=True)
    sources: Mapped[list[str]] = mapped_column(JSONB)


# --- AI assistant (phase 7) --------------------------------------------------------------------------

LLM_PURPOSES = ("summary", "weekly", "coach", "eval")
REPORT_STATUSES = ("pending", "done", "failed")


class LlmCall(Base):
    """One request to the model (OS-701): what for, how many tokens and what it cost."""

    __tablename__ = "llm_calls"
    __table_args__ = (CheckConstraint(_in("purpose", LLM_PURPOSES), name="purpose"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    purpose: Mapped[str] = mapped_column(String(20))
    model: Mapped[str] = mapped_column(String(60))
    input_tokens: Mapped[int] = mapped_column(Integer)
    output_tokens: Mapped[int] = mapped_column(Integer)
    cache_read_tokens: Mapped[int] = mapped_column(
        Integer, server_default="0", comment="Served from the prompt cache"
    )
    cache_write_tokens: Mapped[int] = mapped_column(
        Integer, server_default="0", comment="Written to the prompt cache"
    )
    cost_usd: Mapped[float] = mapped_column(
        Float, comment="At the model's list price; half for the Batch API"
    )
    batch: Mapped[bool] = mapped_column(server_default="false", comment="Sent through the Batch API")
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class ActivitySummary(Base):
    """The model's two or three sentences about an activity (OS-703), in the user's language."""

    __tablename__ = "activity_summaries"

    activity_id: Mapped[int] = mapped_column(
        ForeignKey("activities.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = _user_fk()
    language: Mapped[str] = mapped_column(String(5))
    suggested_title: Mapped[str] = mapped_column(String(120))
    summary: Mapped[str] = mapped_column(Text)
    highlights: Mapped[list[str]] = mapped_column(JSONB, server_default="[]")
    model: Mapped[str] = mapped_column(String(60))
    metrics_version: Mapped[int] = mapped_column(SmallInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WeeklyReport(Base):
    """Monday's report on the week that ended (OS-704), generated through the Batch API."""

    __tablename__ = "weekly_reports"
    __table_args__ = (
        UniqueConstraint("user_id", "week_start"),
        CheckConstraint(_in("status", REPORT_STATUSES), name="status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    week_start: Mapped[date] = mapped_column(Date, comment="The Monday of the week reported")
    language: Mapped[str] = mapped_column(String(5))
    status: Mapped[str] = mapped_column(String(10), server_default="pending")
    batch_id: Mapped[str | None] = mapped_column(String(80), comment="The Batch API request it waits for")
    headline: Mapped[str | None] = mapped_column(String(160))
    summary: Mapped[str | None] = mapped_column(Text)
    recommendation: Mapped[str | None] = mapped_column(Text)
    highlights: Mapped[list[str] | None] = mapped_column(JSONB)
    context: Mapped[dict[str, Any] | None] = mapped_column(JSONB, comment="The numbers the model was given")
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ApiToken(Base):
    """A personal token for the read-only MCP server (OS-709). Only its SHA-256 is stored."""

    __tablename__ = "api_tokens"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = _user_fk()
    name: Mapped[str] = mapped_column(String(120))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    prefix: Mapped[str] = mapped_column(String(12), comment="The first characters, to tell tokens apart")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


INSTANCE_KEYS = ("garmin", "anthropic", "resend", "backup_s3")


class InstanceKey(Timestamps, Base):
    """A service key set from the apps instead of the environment: Garmin's Personal API key,
    Anthropic's, Resend's (e-mail) or the backups' S3 secret. Encrypted with zankup.health.crypto and
    never sent back; only its last characters are shown. A key here wins over the environment
    variable (see zankup.instance_keys)."""

    __tablename__ = "instance_keys"
    __table_args__ = (CheckConstraint(_in("name", INSTANCE_KEYS), name="name"),)

    name: Mapped[str] = mapped_column(String(20), primary_key=True)
    secret: Mapped[bytes] = mapped_column(LargeBinary)
    last4: Mapped[str] = mapped_column(String(4), comment="The key's last characters, to recognise it")
    expires_on: Mapped[date | None] = mapped_column(Date, comment="When the key stops working, if known")


class InstanceSetting(Timestamps, Base):
    """One of the instance's settings set from the apps instead of the environment (the AI model and
    budget, the sync interval, backups, alerts...). The value is JSON; a row here wins over the
    environment (see zankup.instance_keys). Secrets go in InstanceKey instead."""

    __tablename__ = "instance_settings"

    name: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[Any] = mapped_column(JSONB)
