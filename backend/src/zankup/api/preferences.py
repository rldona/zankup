"""The signed-in user's preferences (`/api/settings`). For now the theme (OS-214); language, units and
the physiological settings join with OS-223 and OS-212.

Each client keeps its own copy (the PWA in localStorage, so the theme is applied before painting) and
this is the copy that follows the user to other browsers and to the Android app.
"""

from __future__ import annotations

from typing import Literal, cast, get_args

from pydantic import BaseModel
from sqlalchemy.orm import Session

from zankup.api.routing import protected_router
from zankup.auth.deps import CurrentUser, DbSession
from zankup.db.models import User, UserSettings

router = protected_router(prefix="/api/settings", tags=["settings"])

# The themes in packages/core/src/tokens/tokens.json, plus "system" (light or dark from the device).
Theme = Literal["system", "light", "dark", "oled", "highContrast", "forest", "ocean", "sunset"]


class Preferences(BaseModel):
    theme: Theme


class PreferencesUpdate(BaseModel):
    """Only the fields sent are changed."""

    theme: Theme | None = None


def _settings(db: Session, user: User) -> UserSettings:
    row = db.get(UserSettings, user.id)
    if row is None:
        row = UserSettings(user_id=user.id, theme="system")
        db.add(row)
        db.flush()
    return row


def _out(row: UserSettings) -> Preferences:
    theme = row.theme if row.theme in get_args(Theme) else "system"
    return Preferences(theme=cast(Theme, theme))


@router.get("", operation_id="getSettings")
def get_preferences(db: DbSession, user: CurrentUser) -> Preferences:
    return _out(_settings(db, user))


@router.patch("", operation_id="updateSettings")
def update_preferences(body: PreferencesUpdate, db: DbSession, user: CurrentUser) -> Preferences:
    row = _settings(db, user)
    if body.theme is not None:
        row.theme = body.theme
    db.commit()
    return _out(row)
