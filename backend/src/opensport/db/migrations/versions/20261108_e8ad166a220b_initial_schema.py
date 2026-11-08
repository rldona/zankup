"""Initial schema: users, settings, devices, activities, laps, streams and sync_runs (OS-102).

Revision ID: e8ad166a220b
Revises:
Create Date: 2026-11-08 12:53:19.257878+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e8ad166a220b"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("email", name=op.f("uq_users_email")),
    )
    op.create_table(
        "activities",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("source", sa.String(length=10), nullable=False),
        sa.Column(
            "external_id",
            sa.String(length=64),
            nullable=False,
            comment="Garmin activityId, Strava ID or file hash",
        ),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sport", sa.String(length=20), nullable=False),
        sa.Column("sub_sport", sa.String(length=40), nullable=True),
        sa.Column("start_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=True),
        sa.Column("duration_s", sa.Float(), nullable=False),
        sa.Column("moving_s", sa.Float(), nullable=True),
        sa.Column("distance_m", sa.Float(), nullable=True),
        sa.Column("ascent_m", sa.Float(), nullable=True),
        sa.Column("descent_m", sa.Float(), nullable=True),
        sa.Column("avg_hr", sa.SmallInteger(), nullable=True),
        sa.Column("max_hr", sa.SmallInteger(), nullable=True),
        sa.Column("avg_power", sa.SmallInteger(), nullable=True),
        sa.Column("normalized_power", sa.SmallInteger(), nullable=True),
        sa.Column("calories", sa.Integer(), nullable=True),
        sa.Column("training_effect", sa.Float(), nullable=True),
        sa.Column("device", sa.String(length=120), nullable=True),
        sa.Column("fit_path", sa.String(length=255), nullable=True, comment="Relative to DATA_DIR/raw"),
        sa.Column("fit_sha256", sa.String(length=64), nullable=True),
        sa.Column("has_gps", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "bbox",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment="[min_lat, min_lon, max_lat, max_lon]",
        ),
        sa.Column("route_simplified", sa.Text(), nullable=True, comment="Encoded polyline for thumbnails"),
        sa.Column(
            "raw_meta",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment="Source metadata, as received",
        ),
        sa.Column("imported_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("source IN ('garmin', 'strava', 'file')", name=op.f("ck_activities_source")),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_activities_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_activities")),
        sa.UniqueConstraint(
            "user_id", "source", "external_id", name=op.f("uq_activities_user_id_source_external_id")
        ),
    )
    op.create_index(op.f("ix_activities_user_id"), "activities", ["user_id"], unique=False)
    op.create_index(
        "ix_activities_user_sport_start", "activities", ["user_id", "sport", "start_utc"], unique=False
    )
    op.create_index("ix_activities_user_start", "activities", ["user_id", "start_utc"], unique=False)
    op.create_table(
        "devices",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("platform", sa.String(length=10), nullable=False),
        sa.Column("push_endpoint", sa.Text(), nullable=True),
        sa.Column("refresh_token_hash", sa.String(length=128), nullable=True),
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("platform IN ('web', 'android')", name=op.f("ck_devices_platform")),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_devices_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_devices")),
        sa.UniqueConstraint("refresh_token_hash", name=op.f("uq_devices_refresh_token_hash")),
    )
    op.create_index(op.f("ix_devices_user_id"), "devices", ["user_id"], unique=False)
    op.create_table(
        "settings",
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("language", sa.String(length=5), server_default="en", nullable=False),
        sa.Column("units", sa.String(length=10), server_default="metric", nullable=False),
        sa.Column("theme", sa.String(length=20), server_default="system", nullable=False),
        sa.Column("hr_max", sa.SmallInteger(), nullable=True),
        sa.Column("hr_rest", sa.SmallInteger(), nullable=True),
        sa.Column("lthr", sa.SmallInteger(), nullable=True),
        sa.Column("ftp", sa.SmallInteger(), nullable=True),
        sa.Column("zone_model", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("privacy_zones", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("language IN ('en', 'es')", name=op.f("ck_settings_language")),
        sa.CheckConstraint("units IN ('metric', 'imperial')", name=op.f("ck_settings_units")),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_settings_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_settings")),
    )
    op.create_table(
        "sync_runs",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("trigger", sa.String(length=10), nullable=False),
        sa.Column("status", sa.String(length=10), server_default="running", nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("new_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("progress", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.CheckConstraint("status IN ('running', 'success', 'error')", name=op.f("ck_sync_runs_status")),
        sa.CheckConstraint(
            "trigger IN ('cron', 'button', 'initial', 'import')", name=op.f("ck_sync_runs_trigger")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_sync_runs_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sync_runs")),
    )
    op.create_index(op.f("ix_sync_runs_user_id"), "sync_runs", ["user_id"], unique=False)
    op.create_index("ix_sync_runs_user_started", "sync_runs", ["user_id", "started_at"], unique=False)
    op.create_table(
        "laps",
        sa.Column("activity_id", sa.BigInteger(), nullable=False),
        sa.Column("idx", sa.SmallInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("start_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_s", sa.Float(), nullable=False),
        sa.Column("distance_m", sa.Float(), nullable=True),
        sa.Column("avg_hr", sa.SmallInteger(), nullable=True),
        sa.Column("max_hr", sa.SmallInteger(), nullable=True),
        sa.Column("avg_power", sa.SmallInteger(), nullable=True),
        sa.Column("ascent_m", sa.Float(), nullable=True),
        sa.Column("descent_m", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(
            ["activity_id"],
            ["activities.id"],
            name=op.f("fk_laps_activity_id_activities"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_laps_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("activity_id", "idx", name=op.f("pk_laps")),
    )
    op.create_index(op.f("ix_laps_user_id"), "laps", ["user_id"], unique=False)
    op.create_table(
        "streams",
        sa.Column("activity_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("encoding", sa.String(length=20), nullable=False, comment="e.g. json+gzip"),
        sa.Column(
            "series",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            comment="Series present: lat, lon, dist, alt, hr…",
        ),
        sa.Column("sample_count", sa.Integer(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.ForeignKeyConstraint(
            ["activity_id"],
            ["activities.id"],
            name=op.f("fk_streams_activity_id_activities"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_streams_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("activity_id", name=op.f("pk_streams")),
    )
    op.create_index(op.f("ix_streams_user_id"), "streams", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_streams_user_id"), table_name="streams")
    op.drop_table("streams")
    op.drop_index(op.f("ix_laps_user_id"), table_name="laps")
    op.drop_table("laps")
    op.drop_index("ix_sync_runs_user_started", table_name="sync_runs")
    op.drop_index(op.f("ix_sync_runs_user_id"), table_name="sync_runs")
    op.drop_table("sync_runs")
    op.drop_table("settings")
    op.drop_index(op.f("ix_devices_user_id"), table_name="devices")
    op.drop_table("devices")
    op.drop_index("ix_activities_user_start", table_name="activities")
    op.drop_index("ix_activities_user_sport_start", table_name="activities")
    op.drop_index(op.f("ix_activities_user_id"), table_name="activities")
    op.drop_table("activities")
    op.drop_table("users")
