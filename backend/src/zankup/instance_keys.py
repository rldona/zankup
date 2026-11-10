"""Service keys set from the apps: Garmin's Personal API key and Anthropic's.

They used to live only in the environment (GARMIN_PERSONAL_API_KEY, ANTHROPIC_API_KEY). Now they can
also be saved from Settings, encrypted (zankup.health.crypto), and a saved key wins over the
environment, which stays as the fallback. `effective` lays the saved keys over the settings, so the
API, the worker and the scheduler read the same thing; it caches for a few seconds, and a write clears
the cache in this process (the others catch up within the TTL).

A key is never sent back: the apps see whether it is set, where from, and its last four characters.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from datetime import date
from typing import Literal

import httpx
from pydantic import SecretStr
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from zankup.core.config import Settings
from zankup.db.models import INSTANCE_KEYS, InstanceKey
from zankup.health import crypto

KeyName = Literal["garmin", "anthropic"]
TTL_S = 15.0


@dataclass(frozen=True)
class Stored:
    value: str
    last4: str
    expires_on: date | None


_lock = threading.Lock()
_cache: tuple[float, dict[str, Stored]] | None = None


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


def forget() -> None:
    """Drop the cache, after a key was saved or removed."""
    global _cache
    with _lock:
        _cache = None


def effective(settings: Settings, session: Session) -> Settings:
    """The settings with the keys saved from the apps laid over the environment's."""
    keys = stored(session, settings)
    update: dict[str, object] = {}
    if "garmin" in keys:
        update["garmin_personal_api_key"] = SecretStr(keys["garmin"].value)
        update["garmin_key_expires_on"] = keys["garmin"].expires_on
    if "anthropic" in keys:
        update["anthropic_api_key"] = SecretStr(keys["anthropic"].value)
    return settings.model_copy(update=update) if update else settings


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
