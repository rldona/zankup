"""Elevation goals: so many metres climbed per week, month or year (Progress → Goals).

Revision ID: f7b3c1d9e2a4
Revises: e5c2a9f1b7d4
Create Date: 2026-11-15 01:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f7b3c1d9e2a4"
down_revision: str | None = "e5c2a9f1b7d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("metric", "goals", type_="check")
    op.create_check_constraint("metric", "goals", "metric IN ('distance', 'time', 'ascent', 'count')")
    op.alter_column(
        "goals",
        "target",
        existing_type=sa.Float(),
        existing_nullable=False,
        comment="Metres, seconds, metres climbed or a count",
        existing_comment="Metres, seconds or a count",
    )


def downgrade() -> None:
    op.alter_column(
        "goals",
        "target",
        existing_type=sa.Float(),
        existing_nullable=False,
        comment="Metres, seconds or a count",
        existing_comment="Metres, seconds, metres climbed or a count",
    )
    op.execute("DELETE FROM goals WHERE metric = 'ascent'")
    op.drop_constraint("metric", "goals", type_="check")
    op.create_check_constraint("metric", "goals", "metric IN ('distance', 'time', 'count')")
