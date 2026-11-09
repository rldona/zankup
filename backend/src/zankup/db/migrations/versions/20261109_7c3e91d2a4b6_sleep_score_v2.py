"""Sleep score, second version: duration from 4 to 8 hours, and deep sleep and REM each against its
own share, so a short night with little deep sleep is no longer rewarded (zankup.health.store).
Recomputes every stored score from the stored totals. The formula is copied here on purpose: this
migration must give the same result even if the code changes later.

Revision ID: 7c3e91d2a4b6
Revises: 5116b9b85ed8
Create Date: 2026-11-09 16:30:00+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7c3e91d2a4b6"
down_revision: str | None = "5116b9b85ed8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

WEIGHTS = {"duration": 0.5, "efficiency": 0.2, "deep": 0.15, "rem": 0.15}


def _clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


def score(asleep: int | None, in_bed: float, deep: int | None, rem: int | None) -> int | None:
    if not asleep or in_bed <= 0:
        return None
    parts = {
        "duration": _clamp((asleep / 3600 - 4) / 4),
        "efficiency": _clamp((asleep / in_bed - 0.70) / 0.25),
    }
    if deep is not None and rem is not None and (deep or rem):
        parts["deep"] = _clamp(deep / asleep / 0.20)
        parts["rem"] = _clamp(rem / asleep / 0.22)
    total = sum(WEIGHTS[k] for k in parts)
    return round(100 * sum(v * WEIGHTS[k] for k, v in parts.items()) / total)


def upgrade() -> None:
    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            "SELECT id, asleep_s, EXTRACT(EPOCH FROM end_utc - start_utc), deep_s, rem_s FROM sleep_sessions"
        )
    ).all()
    for id_, asleep, in_bed, deep, rem in rows:
        connection.execute(
            sa.text("UPDATE sleep_sessions SET score = :score WHERE id = :id"),
            {"score": score(asleep, float(in_bed), deep, rem), "id": id_},
        )


def downgrade() -> None:
    pass  # the old scores are not kept; the next sync of each night writes a score again
