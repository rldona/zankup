"""Best efforts per activity and per-km splits (OS-107).

Revision ID: b8ec1f5a4e1c
Revises: af23544629fc
Create Date: 2026-11-08 13:42:36.468930+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b8ec1f5a4e1c"
down_revision: str | None = "af23544629fc"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "best_efforts",
        sa.Column("activity_id", sa.BigInteger(), nullable=False),
        sa.Column("distance_key", sa.String(length=20), nullable=False, comment="e.g. 1k, 5k, half_marathon"),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("distance_m", sa.Float(), nullable=False),
        sa.Column("time_s", sa.Float(), nullable=False),
        sa.Column("start_s", sa.Float(), nullable=False, comment="Seconds from the start of the activity"),
        sa.Column("start_distance_m", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(
            ["activity_id"],
            ["activities.id"],
            name=op.f("fk_best_efforts_activity_id_activities"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_best_efforts_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("activity_id", "distance_key", name=op.f("pk_best_efforts")),
    )
    op.create_index(
        "ix_best_efforts_user_distance_time",
        "best_efforts",
        ["user_id", "distance_key", "time_s"],
        unique=False,
    )
    op.create_index(op.f("ix_best_efforts_user_id"), "best_efforts", ["user_id"], unique=False)
    op.add_column(
        "activities",
        sa.Column(
            "splits",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment="Per-km splits: distance_m, time_s, elevation_change_m, avg_hr",
        ),
    )


def downgrade() -> None:
    op.drop_column("activities", "splits")
    op.drop_index(op.f("ix_best_efforts_user_id"), table_name="best_efforts")
    op.drop_index("ix_best_efforts_user_distance_time", table_name="best_efforts")
    op.drop_table("best_efforts")
