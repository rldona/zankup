"""Profile fields (OS-218) and a language that stays unset until the user picks one (OS-223).

Until now the language defaulted to English for everyone, and nobody could change it: those rows go
back to "not chosen", so the browser's language applies until the user picks one in Settings.

Revision ID: 7f2d6377d1cf
Revises: 818557f7543f
Create Date: 2026-11-08 22:26:15.663724+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7f2d6377d1cf"
down_revision: str | None = "818557f7543f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "settings",
        "language",
        existing_type=sa.VARCHAR(length=5),
        nullable=True,
        server_default=None,
        comment="Null until the user picks one: the browser's language is used",
    )
    op.execute("UPDATE settings SET language = NULL")
    op.add_column("users", sa.Column("location", sa.String(length=120), nullable=True))
    op.add_column("users", sa.Column("birth_date", sa.Date(), nullable=True))
    op.add_column("users", sa.Column("sex", sa.String(length=10), nullable=True))
    op.add_column("users", sa.Column("weight_kg", sa.Float(), nullable=True))
    op.add_column("users", sa.Column("height_cm", sa.SmallInteger(), nullable=True))
    op.create_check_constraint(op.f("ck_users_sex"), "users", "sex IN ('female', 'male', 'other')")


def downgrade() -> None:
    op.drop_constraint(op.f("ck_users_sex"), "users", type_="check")
    op.drop_column("users", "height_cm")
    op.drop_column("users", "weight_kg")
    op.drop_column("users", "sex")
    op.drop_column("users", "birth_date")
    op.drop_column("users", "location")
    op.execute("UPDATE settings SET language = 'en' WHERE language IS NULL")
    op.alter_column(
        "settings",
        "language",
        existing_type=sa.VARCHAR(length=5),
        nullable=False,
        server_default="en",
        comment=None,
    )
