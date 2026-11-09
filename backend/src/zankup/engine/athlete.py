"""The athlete the metrics are computed for: settings, profile and what the engine has estimated."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from zankup.db.models import Activity, EstimateRow, User, UserSettings

DEFAULT_HR_MAX = 190.0
DEFAULT_HR_REST = 60.0


@dataclass(frozen=True)
class Athlete:
    hr_max: float
    hr_rest: float
    zone_method: str  # max, reserve or lthr
    lthr: float | None
    ftp: float | None
    sex: str | None
    weight_kg: float | None
    age: float | None


def _latest(db: Session, user_id: int, kind: str) -> float | None:
    return db.scalar(
        select(EstimateRow.value)
        .where(EstimateRow.user_id == user_id, EstimateRow.kind == kind)
        .order_by(EstimateRow.day.desc())
        .limit(1)
    )


def athlete(db: Session, user_id: int, today: date | None = None) -> Athlete:
    today = today or datetime.now(UTC).date()
    user = db.get_one(User, user_id)
    settings = db.get(UserSettings, user_id)
    observed = db.scalar(
        select(func.max(Activity.max_hr)).where(Activity.user_id == user_id, Activity.max_hr <= 230)
    )
    hr_max = float((settings.hr_max if settings else None) or observed or DEFAULT_HR_MAX)
    hr_rest = float((settings.hr_rest if settings else None) or DEFAULT_HR_REST)
    model = (settings.zone_model or {}) if settings else {}
    lthr = (settings.lthr if settings else None) or _latest(db, user_id, "lthr")
    ftp = (settings.ftp if settings else None) or _latest(db, user_id, "ftp")
    age = None
    if user.birth_date:
        age = (today - user.birth_date) / timedelta(days=365.25)
    method = str(model.get("hr", "max"))
    if method == "lthr" and not lthr:
        method = "max"
    return Athlete(
        hr_max=hr_max,
        hr_rest=min(hr_rest, hr_max - 20),
        zone_method=method,
        lthr=float(lthr) if lthr else None,
        ftp=float(ftp) if ftp else None,
        sex=user.sex,
        weight_kg=user.weight_kg,
        age=age,
    )
