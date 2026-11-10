"""The instance's configuration from Settings instead of the environment: service keys (Garmin's
Personal API key, Anthropic's, Resend's, the backups' S3 secret) and settings (/api/instance).

GET says, for each, whether it is set, where from (`app` or `env`), its last four characters and, for
Garmin, when it expires. PUT tries the key against its service and saves it encrypted; DELETE removes
the saved one (the environment's, if any, takes over again). A key is never sent back.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import Depends, HTTPException, status
from pydantic import BaseModel, Field

from zankup import instance_keys
from zankup.api.routing import protected_router
from zankup.auth.deps import CurrentUser, DbSession
from zankup.core.config import Settings, get_settings

router = protected_router(prefix="/api/keys", tags=["keys"])
instance_router = protected_router(prefix="/api/instance", tags=["keys"])

KeyName = Literal["garmin", "anthropic", "resend", "backup_s3"]
# The environment's settings, not the effective ones: this is where the two are told apart.
BaseSettings = Annotated[Settings, Depends(get_settings)]


class KeyStatus(BaseModel):
    name: KeyName
    configured: bool
    source: Literal["app", "env"] | None = Field(description="Saved from the apps, or the environment's")
    last4: str | None = Field(description="The key's last characters, to recognise it")
    expires_on: date | None = None


class KeyIn(BaseModel):
    value: str = Field(min_length=8, max_length=500)
    expires_on: date | None = Field(None, description="Garmin only: when the key stops working")


def _env(settings: Settings, name: KeyName) -> str | None:
    secret = getattr(settings, instance_keys.KEY_FIELDS[name])
    return secret.get_secret_value() if secret else None


def _status(db: DbSession, base: Settings, name: KeyName) -> KeyStatus:
    saved = instance_keys.stored(db, base).get(name)
    if saved is not None:
        return KeyStatus(
            name=name, configured=True, source="app", last4=saved.last4, expires_on=saved.expires_on
        )
    env = _env(base, name)
    return KeyStatus(
        name=name,
        configured=env is not None,
        source="env" if env else None,
        last4=env[-4:] if env else None,
        expires_on=base.garmin_key_expires_on if name == "garmin" and env else None,
    )


@router.get("", operation_id="listKeys")
def list_keys(db: DbSession, user: CurrentUser, base: BaseSettings) -> list[KeyStatus]:
    """The service keys: set or not, where from, and their last characters."""
    return [_status(db, base, name) for name in ("garmin", "anthropic", "resend", "backup_s3")]


@router.put("/{name}", operation_id="saveKey")
def save_key(name: KeyName, body: KeyIn, db: DbSession, user: CurrentUser, base: BaseSettings) -> KeyStatus:
    """Try the key against its service and save it encrypted. A refused key answers 422."""
    value = body.value.strip()
    try:
        instance_keys.check(name, value)
    except instance_keys.InvalidKey as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(error)) from None
    instance_keys.save(db, base, name, value, body.expires_on if name == "garmin" else None)
    db.commit()
    return _status(db, base, name)


@router.delete("/{name}", operation_id="deleteKey")
def delete_key(name: KeyName, db: DbSession, user: CurrentUser, base: BaseSettings) -> KeyStatus:
    """Remove the key saved from the apps; the environment's, if any, is used again."""
    instance_keys.remove(db, name)
    db.commit()
    return _status(db, base, name)


# --- settings --------------------------------------------------------------------------------------


class SettingOut(BaseModel):
    name: str
    value: Any = Field(description="The value in force")
    source: Literal["app", "env", "default"] = Field(
        description="Saved from the apps, the environment's, or the built-in default"
    )


class ModelOut(BaseModel):
    id: str
    input_usd: float = Field(description="USD per million input tokens")
    output_usd: float = Field(description="USD per million output tokens")


class InstanceOut(BaseModel):
    settings: list[SettingOut]
    models: list[ModelOut] = Field(description="The AI models the budget knows the price of")


def _instance(db: DbSession, base: Settings) -> InstanceOut:
    from zankup.ai.client import PRICES

    saved = instance_keys.saved_settings(db)
    current = instance_keys.effective(base, db)
    out = []
    for name in instance_keys.SETTINGS:
        value = getattr(current, name)
        source: Literal["app", "env", "default"] = (
            "app" if name in saved else "env" if name in base.model_fields_set else "default"
        )
        out.append(
            SettingOut(name=name, value=str(value) if isinstance(value, Path) else value, source=source)
        )
    models = [ModelOut(id=m, input_usd=i, output_usd=o) for m, (i, o) in PRICES.items()]
    return InstanceOut(settings=out, models=models)


@instance_router.get("", operation_id="getInstance")
def get_instance(db: DbSession, user: CurrentUser, base: BaseSettings) -> InstanceOut:
    """The settings the apps can change, each with its value in force and where it comes from."""
    return _instance(db, base)


@instance_router.patch("", operation_id="updateInstance")
def update_instance(
    changes: dict[str, Any], db: DbSession, user: CurrentUser, base: BaseSettings
) -> InstanceOut:
    """Change some settings; null for one removes the value saved here, so the environment's (or the
    default) applies again. A value the environment would refuse answers 422."""
    try:
        instance_keys.save_settings(db, changes)
    except ValueError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(error)) from None
    db.commit()
    return _instance(db, base)
