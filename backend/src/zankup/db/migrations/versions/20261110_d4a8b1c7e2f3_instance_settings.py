"""Instance settings set from the apps (AI model and budget, sync, alerts, backups, Google Health), and
two more keys: Resend's and the backups' S3 secret.

Revision ID: d4a8b1c7e2f3
Revises: c81f2e6d0a94
Create Date: 2026-11-10 14:00:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d4a8b1c7e2f3"
down_revision: str | None = "c81f2e6d0a94"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "instance_settings",
        sa.Column("name", sa.String(length=40), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("name", name=op.f("pk_instance_settings")),
    )
    op.drop_constraint(op.f("ck_instance_keys_name"), "instance_keys", type_="check")
    op.create_check_constraint(
        op.f("ck_instance_keys_name"),
        "instance_keys",
        "name IN ('garmin', 'anthropic', 'resend', 'backup_s3')",
    )


def downgrade() -> None:
    op.execute("DELETE FROM instance_keys WHERE name IN ('resend', 'backup_s3')")
    op.drop_constraint(op.f("ck_instance_keys_name"), "instance_keys", type_="check")
    op.create_check_constraint(
        op.f("ck_instance_keys_name"), "instance_keys", "name IN ('garmin', 'anthropic')"
    )
    op.drop_table("instance_settings")
