"""Sources: connected data sources, their short-lived tokens and sync state (OS-103).

Revision ID: af23544629fc
Revises: e8ad166a220b
Create Date: 2026-11-08 13:11:10.865717+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "af23544629fc"
down_revision: str | None = "e8ad166a220b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sources",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("access_token", sa.Text(), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "sync_cursor",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            comment="Source-specific sync state",
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "kind IN ('garmin', 'google_health', 'strava', 'file')", name=op.f("ck_sources_kind")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_sources_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sources")),
        sa.UniqueConstraint("user_id", "kind", name=op.f("uq_sources_user_id_kind")),
    )
    op.create_index(op.f("ix_sources_user_id"), "sources", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_sources_user_id"), table_name="sources")
    op.drop_table("sources")
