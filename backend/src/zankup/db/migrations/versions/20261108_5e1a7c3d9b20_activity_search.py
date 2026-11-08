"""Advanced search (OS-219): full-text search on names and descriptions, accent-insensitive.
Valid for English and Spanish (`simple` configuration), plus an index for distance filters.

`unaccent` is a trusted extension (PostgreSQL 13+), so the database owner can create it. It is not
IMMUTABLE, so an immutable wrapper is what the index uses.

Revision ID: 5e1a7c3d9b20
Revises: cbe3bd630a94
Create Date: 2026-11-08 23:30:00+00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "5e1a7c3d9b20"
down_revision: str | None = "cbe3bd630a94"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")
    op.execute(
        """
        CREATE OR REPLACE FUNCTION zankup_search_text(name text, description text)
        RETURNS tsvector LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
          SELECT to_tsvector('simple', public.unaccent('public.unaccent'::regdictionary,
                 coalesce(name, '') || ' ' || coalesce(description, '')))
        $$
        """
    )
    op.execute(
        "CREATE INDEX ix_activities_search ON activities USING gin (zankup_search_text(name, description))"
    )
    op.create_index("ix_activities_user_distance", "activities", ["user_id", "distance_m"])


def downgrade() -> None:
    op.drop_index("ix_activities_user_distance", table_name="activities")
    op.execute("DROP INDEX IF EXISTS ix_activities_search")
    op.execute("DROP FUNCTION IF EXISTS zankup_search_text(text, text)")
