"""Service keys set from the apps (Garmin's Personal API key, Anthropic's), encrypted.

Revision ID: c81f2e6d0a94
Revises: a3d9c41e7b52
Create Date: 2026-11-10 12:30:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c81f2e6d0a94"
down_revision: str | None = "a3d9c41e7b52"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "instance_keys",
        sa.Column("name", sa.String(length=20), nullable=False),
        sa.Column("secret", sa.LargeBinary(), nullable=False),
        sa.Column(
            "last4", sa.String(length=4), nullable=False, comment="The key's last characters, to recognise it"
        ),
        sa.Column("expires_on", sa.Date(), nullable=True, comment="When the key stops working, if known"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("name IN ('garmin', 'anthropic')", name=op.f("ck_instance_keys_name")),
        sa.PrimaryKeyConstraint("name", name=op.f("pk_instance_keys")),
    )


def downgrade() -> None:
    op.drop_table("instance_keys")
