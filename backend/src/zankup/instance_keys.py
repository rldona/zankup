"""The instance's configuration set from the apps: service keys and settings.

Keys (Garmin's Personal API key, Anthropic's, Resend's, the backups' S3 secret) are saved encrypted
(zankup.health.crypto); settings (the AI model and budget, the sync interval, alerts, backups, Google
Health; SETTINGS below) as JSON. Both used to live only in the environment. Now a value saved from
Settings wins over the environment's, which stays as the fallback. `effective` lays what was saved
over the settings, so the API, the worker and the scheduler read the same thing. It caches for a few
seconds; a write clears the cache in this process, and the others catch up within the TTL.

A key is never sent back: the apps see whether it is set, where from, and its last four characters.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from datetime import date
from typing import Annotated, Any, Literal

import httpx
from pydantic import SecretStr, TypeAdapter, ValidationError
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from zankup.core.config import Settings
from zankup.db.models import INSTANCE_KEYS, InstanceKey, InstanceSetting
from zankup.health import crypto

KeyName = Literal["garmin", "anthropic", "resend", "backup_s3"]

# The key each saved key replaces in the settings.
KEY_FIELDS: dict[str, str] = {
    "garmin": "garmin_personal_api_key",
    "anthropic": "anthropic_api_key",
    "resend": "resend_api_key",
    "backup_s3": "backup_s3_secret_access_key",
}

# The settings that can be changed from the apps. Everything the server needs before anyone can sign in
# (the database, the JWT secret that encrypts the keys, passkeys, Google's OAuth app) stays in the
# environment.
SETTINGS: tuple[str, ...] = (
    "ai_model",
    "ai_monthly_budget_usd",
    "weekly_report_hour_utc",
    "sync_interval_minutes",
    "alert_email",
    "backup_hour_utc",
    "backup_keep_days",
    "backup_s3_endpoint",
    "backup_s3_bucket",
    "backup_s3_region",
    "backup_s3_access_key_id",
    "google_health_enabled",
)
TTL_S = 15.0


@dataclass(frozen=True)
class Stored:
    value: str
    last4: str
    expires_on: date | None


_lock = threading.Lock()
_cache: tuple[float, dict[str, Stored]] | None = None
_settings_cache: tuple[float, dict[str, Any]] | None = None


def _context(name: str) -> str:
    return f"instance_key:{name}"


def stored(session: Session, settings: Settings) -> dict[str, Stored]:
    """The keys saved from the apps, decrypted (cached for TTL_S). A key that no longer decrypts (the
    JWT secret changed) is left out, as if it had never been set."""
    global _cache
    with _lock:
        if _cache is not None and time.monotonic() - _cache[0] < TTL_S:
            return _cache[1]
    out: dict[str, Stored] = {}
    for row in session.scalars(select(InstanceKey)):
        value = crypto.decrypt(settings, row.secret, context=_context(row.name))
        if value:
            out[row.name] = Stored(value, row.last4, row.expires_on)
    with _lock:
        _cache = (time.monotonic(), out)
    return out


def saved_settings(session: Session) -> dict[str, Any]:
    """The settings saved from the apps (cached for TTL_S)."""
    global _settings_cache
    with _lock:
        if _settings_cache is not None and time.monotonic() - _settings_cache[0] < TTL_S:
            return _settings_cache[1]
    out = {row.name: row.value for row in session.scalars(select(InstanceSetting)) if row.name in SETTINGS}
    with _lock:
        _settings_cache = (time.monotonic(), out)
    return out


def forget() -> None:
    """Drop the caches, after a key or a setting was saved or removed."""
    global _cache, _settings_cache
    with _lock:
        _cache = None
        _settings_cache = None


def effective(settings: Settings, session: Session) -> Settings:
    """The settings with the keys and settings saved from the apps laid over the environment's."""
    keys = stored(session, settings)
    update: dict[str, object] = dict(saved_settings(session))
    for name, saved in keys.items():
        update[KEY_FIELDS[name]] = SecretStr(saved.value)
    if "garmin" in keys:
        update["garmin_key_expires_on"] = keys["garmin"].expires_on
    return settings.model_copy(update=update) if update else settings


def validate_setting(name: str, value: Any) -> Any:
    """`value` checked and converted as the environment's would be (types, bounds); ValueError if not."""
    if name not in SETTINGS:
        raise ValueError(f"{name} cannot be set from the apps")
    field = Settings.model_fields[name]
    kind: Any = Annotated[field.annotation, *field.metadata] if field.metadata else field.annotation
    adapter: TypeAdapter[Any] = TypeAdapter(kind)
    try:
        checked = adapter.validate_python(value)
    except ValidationError as error:
        raise ValueError(error.errors()[0]["msg"]) from None
    if name == "alert_email" and checked is not None and "@" not in str(checked):
        raise ValueError("An e-mail address is needed")
    return checked.isoformat() if isinstance(checked, date) else checked


def save_settings(session: Session, changes: dict[str, Any]) -> None:
    """Save each setting (None removes it, so the environment's applies again). Values are validated."""
    checked = {name: validate_setting(name, value) for name, value in changes.items() if value is not None}
    for name, value in changes.items():
        row = session.get(InstanceSetting, name)
        if value is None:
            if row is not None:
                session.delete(row)
            continue
        row = row or InstanceSetting(name=name)
        row.value = checked[name]
        session.add(row)
    session.flush()
    forget()


def save(session: Session, settings: Settings, name: KeyName, value: str, expires_on: date | None) -> None:
    assert name in INSTANCE_KEYS
    row = session.get(InstanceKey, name) or InstanceKey(name=name)
    row.secret = crypto.encrypt(settings, value, context=_context(name))
    row.last4 = value[-4:]
    row.expires_on = expires_on
    session.add(row)
    session.flush()
    forget()


def remove(session: Session, name: KeyName) -> bool:
    removed = session.execute(delete(InstanceKey).where(InstanceKey.name == name)).rowcount  # type: ignore[attr-defined]
    forget()
    return bool(removed)


class InvalidKey(ValueError):
    pass


def check(name: KeyName, value: str, http: httpx.Client | None = None) -> None:
    """Try the key against its service before saving it; raise InvalidKey when it is refused."""
    if name in ("resend", "backup_s3"):
        return  # no call proves these alone: Resend's sending keys cannot list anything, S3 needs the rest
    http = http or httpx.Client(timeout=15)
    if name == "anthropic":
        response = http.get(
            "https://api.anthropic.com/v1/models",
            headers={"x-api-key": value, "anthropic-version": "2023-06-01"},
            params={"limit": 1},
        )
        if response.status_code in (401, 403):
            raise InvalidKey("Anthropic did not accept this key")
        response.raise_for_status()
        return
    from zankup.sync.garmin import GarminAuthError, GarminClient, MemoryTokenCache

    try:
        GarminClient(value, MemoryTokenCache(), http=http, sleep=lambda _: None).access_token(force=True)
    except GarminAuthError as error:
        raise InvalidKey("Garmin did not accept this key") from error
