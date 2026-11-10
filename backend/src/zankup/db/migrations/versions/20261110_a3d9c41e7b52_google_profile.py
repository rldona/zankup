"""The photo of the linked Google account (users.avatar_url), shown on the profile and in the apps.

Revision ID: a3d9c41e7b52
Revises: 7c3e91d2a4b6
Create Date: 2026-11-10 00:40:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a3d9c41e7b52"
down_revision: str | None = "7c3e91d2a4b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("avatar_url", sa.String(500), nullable=True, comment="Linked Google photo"),
    )


def downgrade() -> None:
    op.drop_column("users", "avatar_url")
