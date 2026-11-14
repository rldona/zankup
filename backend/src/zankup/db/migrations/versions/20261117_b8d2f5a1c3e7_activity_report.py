"""The longer report on an activity ("Tell me more"): activity_reports, and "report" among the purposes
of the model's calls.

Revision ID: b8d2f5a1c3e7
Revises: a1c4e7b9d2f6
Create Date: 2026-11-17 01:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b8d2f5a1c3e7"
down_revision: str | None = "a1c4e7b9d2f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "activity_reports",
        sa.Column("activity_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("language", sa.String(length=5), nullable=False),
        sa.Column(
            "sections",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            comment="headline, effort, story, month, verdict and next",
        ),
        sa.Column("model", sa.String(length=60), nullable=False),
        sa.Column("metrics_version", sa.SmallInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["activity_id"],
            ["activities.id"],
            name=op.f("fk_activity_reports_activity_id_activities"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_activity_reports_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("activity_id", name=op.f("pk_activity_reports")),
    )
    op.create_index(op.f("ix_activity_reports_user_id"), "activity_reports", ["user_id"], unique=False)
    op.drop_constraint("purpose", "llm_calls", type_="check")
    op.create_check_constraint(
        "purpose", "llm_calls", "purpose IN ('summary', 'report', 'weekly', 'coach', 'eval')"
    )


def downgrade() -> None:
    op.execute("DELETE FROM llm_calls WHERE purpose = 'report'")
    op.drop_constraint("purpose", "llm_calls", type_="check")
    op.create_check_constraint("purpose", "llm_calls", "purpose IN ('summary', 'weekly', 'coach', 'eval')")
    op.drop_index(op.f("ix_activity_reports_user_id"), table_name="activity_reports")
    op.drop_table("activity_reports")
