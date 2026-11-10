"""Habitual gear: one pair of shoes, one bike… marked as the one used most, at most one per kind.

Revision ID: e5c2a9f1b7d4
Revises: d4a8b1c7e2f3
Create Date: 2026-11-10 17:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e5c2a9f1b7d4"
down_revision: str | None = "d4a8b1c7e2f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "gear",
        sa.Column(
            "habitual",
            sa.Boolean(),
            server_default="false",
            nullable=False,
            comment="The one of its kind used most: highlighted, and preferred for new activities",
        ),
    )
    op.create_index(
        "uq_gear_habitual_kind",
        "gear",
        ["user_id", "kind"],
        unique=True,
        postgresql_where=sa.text("habitual"),
    )


def downgrade() -> None:
    op.drop_index("uq_gear_habitual_kind", table_name="gear", postgresql_where=sa.text("habitual"))
    op.drop_column("gear", "habitual")
