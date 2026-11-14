"""OAuth for the MCP server: AI assistants register themselves (oauth_clients) and get a code
(oauth_codes) when the person authorises them, then a token like the personal ones.

Revision ID: a1c4e7b9d2f6
Revises: f7b3c1d9e2a4
Create Date: 2026-11-16 01:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a1c4e7b9d2f6"
down_revision: str | None = "f7b3c1d9e2a4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "oauth_clients",
        sa.Column("id", sa.String(length=64), nullable=False, comment="The client_id"),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("redirect_uris", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_oauth_clients")),
    )
    op.create_table(
        "oauth_codes",
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("client_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("redirect_uri", sa.String(length=2000), nullable=False),
        sa.Column("code_challenge", sa.String(length=128), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["client_id"],
            ["oauth_clients.id"],
            name=op.f("fk_oauth_codes_client_id_oauth_clients"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_oauth_codes_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("code_hash", name=op.f("pk_oauth_codes")),
    )
    op.create_index(op.f("ix_oauth_codes_user_id"), "oauth_codes", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_oauth_codes_user_id"), table_name="oauth_codes")
    op.drop_table("oauth_codes")
    op.drop_table("oauth_clients")
