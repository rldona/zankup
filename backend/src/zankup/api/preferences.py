"""The signed-in user's preferences (`/api/settings`): theme (OS-214), language (OS-223), units and the
heart-rate settings the zones and effort are computed with (OS-212).

Each client keeps its own copy (the PWA in localStorage, so the theme is applied before painting) and
this is the copy that follows the user to other browsers and to the Android app.
"""

from __future__ import annotations

from typing import Literal, cast, get_args

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from zankup.api.routing import protected_router
from zankup.auth.deps import CurrentUser, DbSession
from zankup.db.models import Activity, User, UserSettings

router = protected_router(prefix="/api/settings", tags=["settings"])

# The themes in packages/core/src/tokens/tokens.json, plus "system" (light or dark from the device).
Theme = Literal["system", "light", "dark", "oled", "highContrast", "forest", "ocean", "sunset"]


Language = Literal["en", "es"]
Units = Literal["metric", "imperial"]


class Preferences(BaseModel):
    theme: Theme
    language: Language
    units: Units
    hr_max: int | None = Field(description="Max heart rate set by the user")
    hr_rest: int | None = Field(description="Resting heart rate set by the user")
    hr_max_estimate: int | None = Field(
        description="Highest heart rate recorded in an activity: the zones use it until hr_max is set"
    )


class PreferencesUpdate(BaseModel):
    """Only the fields sent are changed. Send null for hr_max or hr_rest to clear them."""

    theme: Theme | None = None
    language: Language | None = None
    units: Units | None = None
    hr_max: int | None = Field(None, ge=100, le=240)
    hr_rest: int | None = Field(None, ge=25, le=120)


def _settings(db: Session, user: User) -> UserSettings:
    row = db.get(UserSettings, user.id)
    if row is None:
        row = UserSettings(user_id=user.id, theme="system", language="en", units="metric")
        db.add(row)
        db.flush()
    return row


def _out(db: Session, row: UserSettings) -> Preferences:
    theme = row.theme if row.theme in get_args(Theme) else "system"
    estimate = db.scalar(select(func.max(Activity.max_hr)).where(Activity.user_id == row.user_id))
    return Preferences(
        theme=cast(Theme, theme),
        language=cast(Language, row.language),
        units=cast(Units, row.units),
        hr_max=row.hr_max,
        hr_rest=row.hr_rest,
        hr_max_estimate=estimate,
    )


@router.get("", operation_id="getSettings")
def get_preferences(db: DbSession, user: CurrentUser) -> Preferences:
    return _out(db, _settings(db, user))


@router.patch("", operation_id="updateSettings")
def update_preferences(body: PreferencesUpdate, db: DbSession, user: CurrentUser) -> Preferences:
    row = _settings(db, user)
    sent = body.model_fields_set
    for name in ("theme", "language", "units"):
        if name in sent and getattr(body, name) is not None:
            setattr(row, name, getattr(body, name))
    for name in ("hr_max", "hr_rest"):
        if name in sent:
            setattr(row, name, getattr(body, name))
    db.commit()
    return _out(db, row)
