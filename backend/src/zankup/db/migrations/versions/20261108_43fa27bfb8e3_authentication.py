"""Authentication: password hash and TOTP on users, session expiry on devices (OS-110).

Revision ID: 43fa27bfb8e3
Revises: 21f0d6022257
Create Date: 2026-11-08 14:33:35.134794+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "43fa27bfb8e3"
down_revision: str | None = "21f0d6022257"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("devices", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "users", sa.Column("password_hash", sa.String(length=255), nullable=True, comment="Argon2id")
    )
    op.add_column(
        "users",
        sa.Column(
            "totp_secret_enc",
            sa.Text(),
            nullable=True,
            comment="Encrypted with a key derived from JWT_SECRET",
        ),
    )
    op.add_column("users", sa.Column("totp_enabled_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "totp_last_counter", sa.BigInteger(), nullable=True, comment="Last accepted step: no replays"
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "totp_last_counter")
    op.drop_column("users", "totp_enabled_at")
    op.drop_column("users", "totp_secret_enc")
    op.drop_column("users", "password_hash")
    op.drop_column("devices", "expires_at")
