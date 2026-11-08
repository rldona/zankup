"""Sign-in with Google (OS-220): the linked Google account, unique per user.

Revision ID: cbe3bd630a94
Revises: becafffbb1bf
Create Date: 2026-11-08 22:51:45.453402+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "cbe3bd630a94"
down_revision: str | None = "becafffbb1bf"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:

    op.add_column(
        "users",
        sa.Column(
            "google_sub",
            sa.String(length=255),
            nullable=True,
            comment="Linked Google account (OS-220): only this one can sign in",
        ),
    )
    op.create_unique_constraint(op.f("uq_users_google_sub"), "users", ["google_sub"])


def downgrade() -> None:

    op.drop_constraint(op.f("uq_users_google_sub"), "users", type_="unique")
    op.drop_column("users", "google_sub")
