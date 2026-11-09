"""The signed-in user's preferences (`/api/settings`): theme (OS-214), language (OS-223), units and the
heart-rate settings the zones and effort are computed with (OS-212), the privacy zones (OS-407) and
which push notifications to send (OS-402), and which AI features are on (OS-708).

Each client keeps its own copy (the PWA in localStorage, so the theme is applied before painting) and
this is the copy that follows the user to other browsers and to the Android app.
"""

from __future__ import annotations

from typing import Literal, cast, get_args

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from zankup.ai import ai_preferences
from zankup.api.routing import protected_router
from zankup.auth.deps import CurrentUser, DbSession
from zankup.db.models import Activity, User, UserSettings
from zankup.notify import preferences
from zankup.privacy import clean_zones

router = protected_router(prefix="/api/settings", tags=["settings"])

# The themes in packages/core/src/tokens/tokens.json, plus "system" (light or dark from the device).
Theme = Literal["system", "light", "dark", "oled", "highContrast", "forest", "ocean", "sunset"]


Language = Literal["en", "es"]
HrModel = Literal["max", "reserve", "lthr"]
Units = Literal["metric", "imperial"]


class PrivacyZone(BaseModel):
    id: str = Field(max_length=40)
    name: str = Field(default="", max_length=120)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    radius_m: float = Field(ge=100, le=5000)


class Notifications(BaseModel):
    activity: bool = True
    record: bool = True
    sync_error: bool = True
    garmin_key: bool = True
    estimate: bool = False
    import_: bool = Field(default=True, alias="import")
    health_reauth: bool = True
    weekly: bool = Field(default=True, description="Monday's AI report (OS-704)")

    model_config = {"populate_by_name": True}


class AiPreferences(BaseModel):
    """Which AI features are on (OS-708); `enabled` is the global switch."""

    enabled: bool = True
    summaries: bool = Field(default=True, description="A summary of each new activity")
    weekly: bool = Field(default=True, description="Monday's report on the week")


class Preferences(BaseModel):
    theme: Theme
    language: Language | None = Field(description="Null until picked: clients use the device's language")
    units: Units
    hr_max: int | None = Field(description="Max heart rate set by the user")
    hr_rest: int | None = Field(description="Resting heart rate set by the user")
    hr_max_estimate: int | None = Field(
        description="Highest heart rate recorded in an activity: the zones use it until hr_max is set"
    )
    zone_model: HrModel = Field(description="HR zones: share of max HR, of HR reserve, or of LTHR")
    lthr: int | None = Field(description="Lactate threshold HR set by the user (else the estimate)")
    ftp: int | None = Field(description="FTP set by the user (else the estimate)")
    privacy_zones: list[PrivacyZone] = Field(description="Hidden from anything shared")
    notifications: Notifications
    ai: AiPreferences


class PreferencesUpdate(BaseModel):
    """Only the fields sent are changed. Null clears the language, hr_max or hr_rest."""

    theme: Theme | None = None
    language: Language | None = None
    units: Units | None = None
    hr_max: int | None = Field(None, ge=100, le=240)
    hr_rest: int | None = Field(None, ge=25, le=120)
    zone_model: HrModel | None = None
    lthr: int | None = Field(None, ge=80, le=220)
    ftp: int | None = Field(None, ge=30, le=600)
    privacy_zones: list[PrivacyZone] | None = Field(None, max_length=20)
    notifications: Notifications | None = None
    ai: AiPreferences | None = None


def _settings(db: Session, user: User) -> UserSettings:
    row = db.get(UserSettings, user.id)
    if row is None:
        row = UserSettings(user_id=user.id, theme="system", units="metric")
        db.add(row)
        db.flush()
    return row


def _out(db: Session, row: UserSettings) -> Preferences:
    theme = row.theme if row.theme in get_args(Theme) else "system"
    estimate = db.scalar(select(func.max(Activity.max_hr)).where(Activity.user_id == row.user_id))
    return Preferences(
        theme=cast(Theme, theme),
        language=cast(Language, row.language) if row.language in get_args(Language) else None,
        units=cast(Units, row.units),
        hr_max=row.hr_max,
        hr_rest=row.hr_rest,
        hr_max_estimate=estimate,
        zone_model=cast(HrModel, (row.zone_model or {}).get("hr", "max")),
        lthr=row.lthr,
        ftp=row.ftp,
        privacy_zones=[PrivacyZone(**z) for z in clean_zones(row.privacy_zones or [])],
        notifications=Notifications.model_validate(preferences(db, row.user_id)),
        ai=AiPreferences.model_validate(ai_preferences(db, row.user_id)),
    )


@router.get("", operation_id="getSettings")
def get_preferences(db: DbSession, user: CurrentUser) -> Preferences:
    return _out(db, _settings(db, user))


@router.patch("", operation_id="updateSettings")
def update_preferences(body: PreferencesUpdate, db: DbSession, user: CurrentUser) -> Preferences:
    row = _settings(db, user)
    sent = body.model_fields_set
    for name in ("theme", "units"):
        if name in sent and getattr(body, name) is not None:
            setattr(row, name, getattr(body, name))
    before = (row.hr_max, row.hr_rest, row.lthr, row.ftp, (row.zone_model or {}).get("hr"))
    for name in ("language", "hr_max", "hr_rest", "lthr", "ftp"):
        if name in sent:
            setattr(row, name, getattr(body, name))
    if "privacy_zones" in sent and body.privacy_zones is not None:
        row.privacy_zones = clean_zones([z.model_dump() for z in body.privacy_zones]) or None
    if "notifications" in sent and body.notifications is not None:
        row.notifications = body.notifications.model_dump(by_alias=True)
    if "ai" in sent and body.ai is not None:
        row.ai = body.ai.model_dump()
    if "zone_model" in sent and body.zone_model is not None:
        row.zone_model = {**(row.zone_model or {}), "hr": body.zone_model}
    if before != (row.hr_max, row.hr_rest, row.lthr, row.ftp, (row.zone_model or {}).get("hr")):
        from zankup.engine.run import queue_full

        queue_full(db, user.id, "heart rate or zone settings changed")  # OS-301, OS-314
    db.commit()
    return _out(db, row)
