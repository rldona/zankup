"""Encryption of long-lived source credentials (OAuth refresh tokens) in the database.

AES-256-GCM with a key derived (HKDF-SHA256) from JWT_SECRET, so no new secret has to be set. Changing
JWT_SECRET signs everyone out anyway; the stored tokens can then no longer be read and the source has to
be connected again, which `decrypt` reports as None.
"""

from __future__ import annotations

import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from zankup.core.config import Settings

VERSION = b"\x01"
INFO = b"zankup source secrets v1"


def _key(settings: Settings) -> bytes:
    secret = settings.jwt_secret.get_secret_value() if settings.jwt_secret else "dev-only"
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=INFO).derive(secret.encode())


def encrypt(settings: Settings, plaintext: str, *, context: str) -> bytes:
    """`context` (e.g. "google_health:7") is authenticated: a value cannot be moved to another row."""
    nonce = os.urandom(12)
    return VERSION + nonce + AESGCM(_key(settings)).encrypt(nonce, plaintext.encode(), context.encode())


def decrypt(settings: Settings, blob: bytes | None, *, context: str) -> str | None:
    if not blob or blob[:1] != VERSION or len(blob) < 13 + 16:
        return None
    try:
        return AESGCM(_key(settings)).decrypt(blob[1:13], blob[13:], context.encode()).decode()
    except InvalidTag:
        return None
