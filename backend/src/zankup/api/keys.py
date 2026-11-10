"""The service keys from Settings (Garmin's Personal API key, Anthropic's), instead of the environment.

GET says, for each, whether it is set, where from (`app` or `env`), its last four characters and, for
Garmin, when it expires. PUT tries the key against its service and saves it encrypted; DELETE removes
the saved one (the environment's, if any, takes over again). A key is never sent back.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from fastapi import Depends, HTTPException, status
from pydantic import BaseModel, Field

from zankup import instance_keys
from zankup.api.routing import protected_router
from zankup.auth.deps import CurrentUser, DbSession
from zankup.core.config import Settings, get_settings

router = protected_router(prefix="/api/keys", tags=["keys"])

KeyName = Literal["garmin", "anthropic"]
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
    secret = settings.garmin_personal_api_key if name == "garmin" else settings.anthropic_api_key
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
    """Garmin's and Anthropic's keys: set or not, where from, and their last characters."""
    return [_status(db, base, "garmin"), _status(db, base, "anthropic")]


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
