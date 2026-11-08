"""Sync runs can be queued: the Sync button creates the run before the worker starts it (OS-112).

Revision ID: f1217e33f96d
Revises: 43fa27bfb8e3
Create Date: 2026-11-08 14:53:39.667494+00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "f1217e33f96d"
down_revision: str | None = "43fa27bfb8e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(op.f("ck_sync_runs_status"), "sync_runs", type_="check")
    op.create_check_constraint(
        op.f("ck_sync_runs_status"), "sync_runs", "status IN ('queued', 'running', 'success', 'error')"
    )


def downgrade() -> None:
    op.execute("UPDATE sync_runs SET status = 'error', error = 'Never started' WHERE status = 'queued'")
    op.drop_constraint(op.f("ck_sync_runs_status"), "sync_runs", type_="check")
    op.create_check_constraint(
        op.f("ck_sync_runs_status"), "sync_runs", "status IN ('running', 'success', 'error')"
    )
