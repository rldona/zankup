"""Strength sets (OS-225): reps, weight and exercise per set, read from the FIT file.

Revision ID: 68d31f9294a1
Revises: 5e1a7c3d9b20
Create Date: 2026-11-08 23:10:42.849927+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "68d31f9294a1"
down_revision: str | None = "5e1a7c3d9b20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:

    op.add_column(
        "activities",
        sa.Column(
            "sets",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment="Strength sets (OS-225): start_s, duration_s, kind, reps, weight_kg, category",
        ),
    )


def downgrade() -> None:

    op.drop_column("activities", "sets")
