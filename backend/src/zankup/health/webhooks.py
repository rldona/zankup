"""Google Health new-data notifications (OS-604).

Google POSTs to `/api/webhooks/google-health` when there is new data. Each request carries:
- `Authorization`: the secret given when the subscriber was created (GOOGLE_HEALTH_WEBHOOK_SECRET);
- `GOOGLE-HEALTH-API-SIGNATURE`: an ECDSA P-256 / SHA-256 signature of the raw body, made with Tink.
  The header is base64: a 5-byte Tink prefix (version 0x01 and the 4-byte key id) and a DER signature.
  Google's public keys (a Tink keyset, rotated every 30 days) are fetched and cached.

The body only says which user and data type changed, never the values: the endpoint answers 204 at
once and queues a sync of that user (deduplicated per minute). The hourly sync stays as a fallback.
When the subscriber is created Google checks the endpoint twice: with the secret (expects 200) and
without it (expects 401).
"""

from __future__ import annotations

import base64
import hmac
import json
import logging
import threading
import time
from datetime import UTC, datetime
from typing import Any

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select

from zankup.auth.deps import AppSettings, DbSession
from zankup.db.models import Source
from zankup.jobs.queue import enqueue

log = logging.getLogger("zankup.health.webhooks")

KEYSET_URL = "https://www.gstatic.com/googlehealthapi/webhooks/webhooks_public_keyset.json"
KEYSET_TTL_S = 3600.0
SIGNATURE_HEADER = "GOOGLE-HEALTH-API-SIGNATURE"

router = APIRouter(prefix="/api/webhooks", tags=["health"])


def _varint(data: bytes, i: int) -> tuple[int, int]:
    shift = value = 0
    while True:
        byte = data[i]
        i += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, i
        shift += 7


def ecdsa_public_key(serialized: bytes) -> ec.EllipticCurvePublicKey:
    """A Tink `EcdsaPublicKey` protobuf: x is field 3 and y field 4 (big-endian bytes)."""
    fields: dict[int, bytes] = {}
    i = 0
    while i < len(serialized):
        tag, i = _varint(serialized, i)
        number, wire = tag >> 3, tag & 7
        if wire == 0:
            _, i = _varint(serialized, i)
        elif wire == 2:
            length, i = _varint(serialized, i)
            fields[number] = serialized[i : i + length]
            i += length
        else:
            raise ValueError(f"Unexpected protobuf wire type {wire}")
    x, y = int.from_bytes(fields[3], "big"), int.from_bytes(fields[4], "big")
    return ec.EllipticCurvePublicNumbers(x, y, ec.SECP256R1()).public_key()


def parse_keyset(keyset: dict[str, Any]) -> dict[int, ec.EllipticCurvePublicKey]:
    keys = {}
    for key in keyset.get("key") or []:
        if key.get("status", "ENABLED") != "ENABLED":
            continue
        data = key.get("keyData") or {}
        try:
            keys[int(key["keyId"])] = ecdsa_public_key(base64.b64decode(data["value"]))
        except (KeyError, ValueError):
            log.warning("Skipped an unreadable Google Health webhook key")
    return keys


class Keys:
    def __init__(self, url: str = KEYSET_URL, http: httpx.Client | None = None) -> None:
        self.url, self.http = url, http
        self.keys: dict[int, ec.EllipticCurvePublicKey] = {}
        self.fetched = 0.0
        self.lock = threading.Lock()

    def get(self, key_id: int) -> ec.EllipticCurvePublicKey | None:
        with self.lock:
            stale = time.monotonic() - self.fetched > KEYSET_TTL_S
            if stale or (key_id not in self.keys and time.monotonic() - self.fetched > 60):
                response = (self.http or httpx.Client(timeout=10)).get(self.url)
                response.raise_for_status()
                self.keys, self.fetched = parse_keyset(response.json()), time.monotonic()
            return self.keys.get(key_id)


KEYS = Keys()


def verify_signature(body: bytes, header: str | None, keys: Keys) -> bool:
    if not header:
        return False
    try:
        raw = base64.b64decode(header)
    except ValueError:
        return False
    if len(raw) < 6 or raw[0] != 0x01:
        return False
    key = keys.get(int.from_bytes(raw[1:5], "big"))
    if key is None:
        return False
    try:
        key.verify(raw[5:], body, ec.ECDSA(hashes.SHA256()))
    except InvalidSignature:
        return False
    return True


def _notifications(body: Any) -> list[dict[str, Any]]:
    items = body if isinstance(body, list) else [body]
    return [dict(i.get("data") or i) for i in items if isinstance(i, dict)]


@router.post("/google-health", status_code=204, include_in_schema=False)
async def google_health(request: Request, db: DbSession, settings: AppSettings) -> Response:
    secret = settings.google_health_webhook_secret
    if secret is None or not settings.integrations()["google_health"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    given = request.headers.get("Authorization", "")
    if not hmac.compare_digest(given.encode(), secret.get_secret_value().encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    raw = await request.body()
    try:
        body = json.loads(raw)
    except ValueError as error:
        raise HTTPException(status.HTTP_400_BAD_REQUEST) from error
    if isinstance(body, dict) and body.get("type") == "verification":
        return Response(status_code=200)
    if not verify_signature(raw, request.headers.get(SIGNATURE_HEADER), KEYS):
        log.warning("Google Health notification with a bad signature")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED)
    users = {str(n.get("healthUserId")) for n in _notifications(body) if n.get("healthUserId")}
    minute = datetime.now(UTC).strftime("%Y%m%d%H%M")
    for source in db.scalars(select(Source).where(Source.kind == "google_health")):
        if (source.sync_cursor or {}).get("health_user_id") in users:
            enqueue(
                db,
                "sync_google_health",
                user_id=source.user_id,
                payload={"trigger": "webhook"},
                dedupe_key=f"sync:google_health:{source.user_id}:{minute}",
                max_attempts=3,
            )
    db.commit()
    return Response(status_code=204)
