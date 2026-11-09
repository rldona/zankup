"""Metrics engine (phase 3): per-activity metrics, daily load, estimates, events, goals, segments.

Revision ID: fc34fcd29895
Revises: 68d31f9294a1
Create Date: 2026-11-09 06:17:33.000648+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "fc34fcd29895"
down_revision: str | None = "68d31f9294a1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:

    op.create_table(
        "daily_load",
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("load", sa.Float(), nullable=False),
        sa.Column("ctl", sa.Float(), nullable=False),
        sa.Column("atl", sa.Float(), nullable=False),
        sa.Column("tsb", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_daily_load_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", "day", name=op.f("pk_daily_load")),
    )
    op.create_table(
        "engine_runs",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=10), server_default="running", nullable=False),
        sa.Column("reason", sa.String(length=60), nullable=False),
        sa.Column("total", sa.Integer(), server_default="0", nullable=False),
        sa.Column("done", sa.Integer(), server_default="0", nullable=False),
        sa.Column("metrics_version", sa.SmallInteger(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_engine_runs_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_engine_runs")),
    )
    op.create_index(op.f("ix_engine_runs_user_id"), "engine_runs", ["user_id"], unique=False)
    op.create_table(
        "estimates",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "kind",
            sa.String(length=30),
            nullable=False,
            comment="ftp, critical_speed, lthr, hr_max, vdot, race_5k…",
        ),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("method", sa.String(length=120), nullable=False),
        sa.Column(
            "source_activity_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column("metrics_version", sa.SmallInteger(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_estimates_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_estimates")),
        sa.UniqueConstraint("user_id", "kind", "day", name=op.f("uq_estimates_user_id_kind_day")),
    )
    op.create_index(op.f("ix_estimates_user_id"), "estimates", ["user_id"], unique=False)
    op.create_table(
        "events",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(length=30), nullable=False, comment="record, estimate_up, ramp"),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("dedupe_key", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_events_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_events")),
        sa.UniqueConstraint("dedupe_key", name=op.f("uq_events_dedupe_key")),
    )
    op.create_index(op.f("ix_events_user_id"), "events", ["user_id"], unique=False)
    op.create_table(
        "goals",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("period", sa.String(length=10), nullable=False),
        sa.Column("metric", sa.String(length=10), nullable=False),
        sa.Column("sport", sa.String(length=20), nullable=True),
        sa.Column("target", sa.Float(), nullable=False, comment="Metres, seconds or a count"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("metric IN ('distance', 'time', 'count')", name=op.f("ck_goals_metric")),
        sa.CheckConstraint("period IN ('week', 'month', 'year')", name=op.f("ck_goals_period")),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_goals_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_goals")),
    )
    op.create_index(op.f("ix_goals_user_id"), "goals", ["user_id"], unique=False)
    op.create_table(
        "activity_metrics",
        sa.Column("activity_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("metrics_version", sa.SmallInteger(), nullable=False),
        sa.Column("trimp", sa.Float(), nullable=True, comment="Banister TRIMP (relative effort)"),
        sa.Column(
            "hr_zones", postgresql.JSONB(astext_type=sa.Text()), nullable=True, comment="Seconds per HR zone"
        ),
        sa.Column(
            "power_zones",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment="Seconds per power zone",
        ),
        sa.Column("gap_distance_m", sa.Float(), nullable=True, comment="Grade-adjusted distance"),
        sa.Column("calories", sa.Float(), nullable=True, comment="Estimated kcal (the device's wins)"),
        sa.Column("efficiency", sa.Float(), nullable=True, comment="Speed (m/min) per bpm"),
        sa.Column("decoupling", sa.Float(), nullable=True, comment="Pa:HR drift, %"),
        sa.Column(
            "power_curve",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment="Best watts per duration (s)",
        ),
        sa.Column(
            "speed_curve",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment="Best m/s per duration (s)",
        ),
        sa.Column(
            "hr_curve",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment="Best average HR per duration (s)",
        ),
        sa.Column(
            "route_group",
            sa.BigInteger(),
            nullable=True,
            comment="Matched routes (OS-309): the first activity of the group",
        ),
        sa.Column("computed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["activity_id"],
            ["activities.id"],
            name=op.f("fk_activity_metrics_activity_id_activities"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_activity_metrics_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("activity_id", name=op.f("pk_activity_metrics")),
    )
    op.create_index(op.f("ix_activity_metrics_user_id"), "activity_metrics", ["user_id"], unique=False)
    op.create_index(
        "ix_activity_metrics_user_route", "activity_metrics", ["user_id", "route_group"], unique=False
    )
    op.create_table(
        "segments",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("track", sa.Text(), nullable=False, comment="Encoded polyline (precision 6)"),
        sa.Column("distance_m", sa.Float(), nullable=False),
        sa.Column("ascent_m", sa.Float(), nullable=True),
        sa.Column("source_activity_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["source_activity_id"],
            ["activities.id"],
            name=op.f("fk_segments_source_activity_id_activities"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_segments_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_segments")),
    )
    op.create_index(op.f("ix_segments_user_id"), "segments", ["user_id"], unique=False)
    op.create_table(
        "segment_efforts",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("segment_id", sa.BigInteger(), nullable=False),
        sa.Column("activity_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("start_s", sa.Float(), nullable=False),
        sa.Column("elapsed_s", sa.Float(), nullable=False),
        sa.Column("avg_hr", sa.SmallInteger(), nullable=True),
        sa.Column("avg_power", sa.SmallInteger(), nullable=True),
        sa.ForeignKeyConstraint(
            ["activity_id"],
            ["activities.id"],
            name=op.f("fk_segment_efforts_activity_id_activities"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["segment_id"],
            ["segments.id"],
            name=op.f("fk_segment_efforts_segment_id_segments"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_segment_efforts_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_segment_efforts")),
        sa.UniqueConstraint(
            "segment_id", "activity_id", name=op.f("uq_segment_efforts_segment_id_activity_id")
        ),
    )
    op.create_index(op.f("ix_segment_efforts_activity_id"), "segment_efforts", ["activity_id"], unique=False)
    op.create_index(op.f("ix_segment_efforts_segment_id"), "segment_efforts", ["segment_id"], unique=False)
    op.create_index(op.f("ix_segment_efforts_user_id"), "segment_efforts", ["user_id"], unique=False)


def downgrade() -> None:

    op.drop_index(op.f("ix_segment_efforts_user_id"), table_name="segment_efforts")
    op.drop_index(op.f("ix_segment_efforts_segment_id"), table_name="segment_efforts")
    op.drop_index(op.f("ix_segment_efforts_activity_id"), table_name="segment_efforts")
    op.drop_table("segment_efforts")
    op.drop_index(op.f("ix_segments_user_id"), table_name="segments")
    op.drop_table("segments")
    op.drop_index("ix_activity_metrics_user_route", table_name="activity_metrics")
    op.drop_index(op.f("ix_activity_metrics_user_id"), table_name="activity_metrics")
    op.drop_table("activity_metrics")
    op.drop_index(op.f("ix_goals_user_id"), table_name="goals")
    op.drop_table("goals")
    op.drop_index(op.f("ix_events_user_id"), table_name="events")
    op.drop_table("events")
    op.drop_index(op.f("ix_estimates_user_id"), table_name="estimates")
    op.drop_table("estimates")
    op.drop_index(op.f("ix_engine_runs_user_id"), table_name="engine_runs")
    op.drop_table("engine_runs")
    op.drop_table("daily_load")
