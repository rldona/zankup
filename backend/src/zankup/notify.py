"""Push notifications (OS-401, OS-402, OS-403), with the Web Push protocol.

`notify()` queues a `push` job when the user wants that kind of notification; the job sends it to
every browser the user subscribed, in the user's language. A subscription the push service reports
as gone (404 or 410) is deleted; one that keeps failing is deleted after `MAX_FAILURES`.

Kinds (and whether they are on by default, OS-402):

- `activity`: a new activity arrived from the sync (only recent ones, never a history backfill).
- `record`: a new best effort.
- `sync_error`: the Garmin sync failed three times in a row.
- `garmin_key`: the Garmin Personal API key expires within 14 days (OS-403).
- `estimate`: an estimate (FTP, critical speed, VDOT) went up. Off by default.
- `import`: an import finished.

The Android app (OS-507) gets the same notifications through Firebase Cloud Messaging (HTTP v1): its
token is kept on its device row (`devices.push_endpoint`) and messages are signed with the service
account in FCM_SERVICE_ACCOUNT. A token FCM no longer knows is forgotten.

Web Push is implemented here with `cryptography` and `pyjwt` (both already needed): payloads are
encrypted with `aes128gcm` (RFC 8291) and requests signed with VAPID (RFC 8292). The VAPID key comes
from VAPID_PRIVATE_KEY or, when that is not set, is generated once and kept on the data volume.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import struct
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
import jwt
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from zankup.core.config import Settings
from zankup.db.models import Device, Job, PushSubscription, UserSettings
from zankup.jobs.queue import enqueue

log = logging.getLogger("zankup.notify")

KINDS = ("activity", "record", "sync_error", "garmin_key", "estimate", "import")
DEFAULTS = {
    "activity": True,
    "record": True,
    "sync_error": True,
    "garmin_key": True,
    "estimate": False,
    "import": True,
}
MAX_FAILURES = 5
TTL_S = 24 * 60 * 60
RECORD_SIZE = 4096

TEXTS: dict[str, dict[str, tuple[str, str]]] = {
    "en": {
        "activity": ("New activity", "{name}: {summary}"),
        "record": ("New record", "{effort} in {time}, your best so far"),
        "sync_error": ("Garmin sync is failing", "The last three syncs failed: {error}"),
        "garmin_key": (
            "Garmin key expires soon",
            "Your Garmin Personal API key expires on {date}: renew it.",
        ),
        "estimate": ("Estimate up", "{label} rose to {value}"),
        "import": ("Import finished", "{created} new activities, {merged} merged"),
        "import_error": ("Import failed", "The import could not finish: open Zankup to see why."),
        "test": ("Notifications work", "This is how Zankup will tell you about new activities."),
    },
    "es": {
        "activity": ("Nueva actividad", "{name}: {summary}"),
        "record": ("Nuevo récord", "{effort} en {time}, tu mejor marca"),
        "sync_error": ("La sincronización con Garmin falla", "Las tres últimas fallaron: {error}"),
        "garmin_key": ("La clave de Garmin caduca pronto", "Tu clave de Garmin caduca el {date}: renuévala."),
        "estimate": ("Estimación al alza", "{label} sube a {value}"),
        "import": ("Importación terminada", "{created} actividades nuevas, {merged} combinadas"),
        "import_error": ("La importación ha fallado", "No se pudo terminar: abre Zankup para ver por qué."),
        "test": ("Las notificaciones funcionan", "Así te avisará Zankup de tus nuevas actividades."),
    },
}
EFFORTS = {
    "400m": "400 m",
    "half_mile": "½ mile",
    "1k": "1 km",
    "1mile": "1 mile",
    "2mile": "2 miles",
    "5k": "5 km",
    "10k": "10 km",
    "15k": "15 km",
    "10mile": "10 miles",
    "20k": "20 km",
    "half_marathon": "Half marathon",
    "marathon": "Marathon",
}
ESTIMATES = {"ftp": "FTP", "critical_speed": "Critical speed", "vdot": "VDOT"}


# --- preferences and queueing -----------------------------------------------------------------------


def preferences(session: Session, user_id: int) -> dict[str, bool]:
    stored = session.scalar(select(UserSettings.notifications).where(UserSettings.user_id == user_id))
    return {kind: bool((stored or {}).get(kind, default)) for kind, default in DEFAULTS.items()}


def notify(session: Session, user_id: int, kind: str, data: dict[str, Any], key: str) -> bool:
    """Queue a notification if the user wants this kind and has somewhere to receive it."""
    if not preferences(session, user_id).get(kind, False):
        return False
    subscribed = session.scalar(
        select(PushSubscription.id).where(PushSubscription.user_id == user_id).limit(1)
    ) or session.scalar(
        select(Device.id).where(Device.user_id == user_id, Device.push_endpoint.is_not(None)).limit(1)
    )
    if subscribed is None:
        return False
    queued = enqueue(
        session,
        "push",
        user_id=user_id,
        payload={"kind": kind, "data": data},
        dedupe_key=f"push:{key}",
        max_attempts=3,
    )
    return queued is not None


# --- message ---------------------------------------------------------------------------------------


def _duration(seconds: float) -> str:
    s = round(seconds)
    h, m, sec = s // 3600, s % 3600 // 60, s % 60
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"


def message(kind: str, data: dict[str, Any], language: str) -> dict[str, Any]:
    """Title, body and the page to open, in the user's language."""
    texts = TEXTS.get(language, TEXTS["en"])
    url = "/"
    values: dict[str, Any] = {}
    match kind:
        case "activity":
            km = (data.get("distance_m") or 0) / 1000
            values = {
                "name": data.get("name") or "",
                "summary": (f"{km:.1f} km · " if km else "") + _duration(data.get("duration_s") or 0),
            }
            url = f"/activities/{data['activity_id']}"
        case "record":
            values = {
                "effort": EFFORTS.get(data.get("distance_key", ""), data.get("distance_key", "")),
                "time": _duration(data.get("time_s") or 0),
            }
            url = f"/activities/{data['activity_id']}"
        case "sync_error":
            values = {"error": str(data.get("error") or "")[:120]}
            url = "/settings"
        case "garmin_key":
            values = {"date": data.get("date", "")}
            url = "/settings"
        case "estimate":
            values = {
                "label": ESTIMATES.get(data.get("kind", ""), data.get("kind", "")),
                "value": round(data.get("value") or 0, 1),
            }
            url = "/profile?tab=estimates"
        case "import":
            if data.get("error"):
                kind = "import_error"
            values = {"created": data.get("created", 0), "merged": data.get("merged", 0)}
            url = "/settings/import"
    title, body = texts.get(kind, texts["test"])
    return {"title": title, "body": body.format(**values), "url": url, "tag": kind}


# --- Web Push ---------------------------------------------------------------------------------------


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def vapid_key(settings: Settings) -> ec.EllipticCurvePrivateKey:
    """The server's VAPID key: VAPID_PRIVATE_KEY (PEM or raw base64url), or one kept on the volume."""
    if settings.vapid_private_key is not None:
        value = settings.vapid_private_key.get_secret_value().strip()
        if value.startswith("-----BEGIN"):
            key = serialization.load_pem_private_key(value.encode(), password=None)
            assert isinstance(key, ec.EllipticCurvePrivateKey)
            return key
        return ec.derive_private_key(int.from_bytes(_unb64(value), "big"), ec.SECP256R1())
    path: Path = settings.data_dir / "vapid_private.pem"
    if path.exists():
        key = serialization.load_pem_private_key(path.read_bytes(), password=None)
        assert isinstance(key, ec.EllipticCurvePrivateKey)
        return key
    key = ec.generate_private_key(ec.SECP256R1())
    path.parent.mkdir(parents=True, exist_ok=True)
    pem = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as file:
        file.write(pem)
    log.info("VAPID key generated", extra={"path": str(path)})
    return key


def public_key(key: ec.EllipticCurvePrivateKey) -> str:
    """The application server key browsers subscribe with (uncompressed point, base64url)."""
    raw = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return _b64(raw)


def _hkdf(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt, info=info).derive(ikm)


def encrypt(payload: bytes, p256dh: str, auth: str) -> bytes:
    """RFC 8291 `aes128gcm` content encoding of one record."""
    ua_public = _unb64(p256dh)
    auth_secret = _unb64(auth)
    ephemeral = ec.generate_private_key(ec.SECP256R1())
    as_public = ephemeral.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    peer = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)
    shared = ephemeral.exchange(ec.ECDH(), peer)
    ikm = _hkdf(auth_secret, shared, b"WebPush: info\x00" + ua_public + as_public, 32)
    salt = os.urandom(16)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    ciphertext = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)
    return salt + struct.pack("!IB", RECORD_SIZE, len(as_public)) + as_public + ciphertext


def vapid_header(key: ec.EllipticCurvePrivateKey, endpoint: str, subject: str) -> str:
    parts = urlsplit(endpoint)
    claims = {"aud": f"{parts.scheme}://{parts.netloc}", "exp": int(time.time()) + 12 * 3600, "sub": subject}
    token = jwt.encode(claims, key, algorithm="ES256")
    return f"vapid t={token}, k={public_key(key)}"


def send(settings: Settings, subscription: PushSubscription, content: dict[str, Any]) -> int:
    """Send one notification. Returns the push service's HTTP status."""
    key = vapid_key(settings)
    body = encrypt(json.dumps(content).encode(), subscription.p256dh, subscription.auth)
    response = httpx.post(
        subscription.endpoint,
        content=body,
        headers={
            "Authorization": vapid_header(key, subscription.endpoint, settings.vapid_subject),
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            "TTL": str(TTL_S),
            "Urgency": "normal",
        },
        timeout=10,
    )
    return response.status_code


# --- Firebase Cloud Messaging (the Android app) -------------------------------------------------------

FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
_fcm_token: dict[str, Any] = {}


def fcm_access_token(account: dict[str, Any]) -> str:
    """An OAuth access token for FCM from the service account (JWT bearer grant), cached ~55 min."""
    now = int(time.time())
    if _fcm_token.get("email") == account["client_email"] and _fcm_token.get("expires", 0) > now + 60:
        return str(_fcm_token["token"])
    token_uri = account.get("token_uri", "https://oauth2.googleapis.com/token")
    assertion = jwt.encode(
        {"iss": account["client_email"], "scope": FCM_SCOPE, "aud": token_uri, "iat": now, "exp": now + 3600},
        account["private_key"],
        algorithm="RS256",
    )
    response = httpx.post(
        token_uri,
        data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion},
        timeout=10,
    )
    response.raise_for_status()
    body = response.json()
    _fcm_token.update(
        email=account["client_email"], token=body["access_token"], expires=now + int(body["expires_in"])
    )
    return str(body["access_token"])


def send_fcm(account: dict[str, Any], token: str, content: dict[str, Any]) -> int:
    """One FCM message. Returns the HTTP status (404 means the token is gone)."""
    tag = str(content.get("tag", ""))
    response = httpx.post(
        f"https://fcm.googleapis.com/v1/projects/{account['project_id']}/messages:send",
        headers={"Authorization": f"Bearer {fcm_access_token(account)}"},
        json={
            "message": {
                "token": token,
                "notification": {"title": content["title"], "body": content["body"]},
                "data": {"url": str(content.get("url", "/")), "tag": tag},
                "android": {"notification": {"tag": tag, "channel_id": "default"}},
            }
        },
        timeout=10,
    )
    return response.status_code


def fcm_account(settings: Settings) -> dict[str, Any] | None:
    if settings.fcm_service_account is None:
        return None
    try:
        account: dict[str, Any] = json.loads(settings.fcm_service_account.get_secret_value())
    except ValueError:
        log.warning("FCM_SERVICE_ACCOUNT is not valid JSON")
        return None
    return account


def deliver(session: Session, settings: Settings, user_id: int, content: dict[str, Any]) -> int:
    """Send to every browser subscription and app of the user. Returns how many accepted it."""
    sent = 0
    account = fcm_account(settings)
    if account is not None:
        for device in session.scalars(
            select(Device).where(Device.user_id == user_id, Device.push_endpoint.is_not(None))
        ):
            try:
                code = send_fcm(account, str(device.push_endpoint), content)
            except (httpx.HTTPError, KeyError, ValueError) as error:
                log.warning("FCM not sent", extra={"device": device.id, "error": str(error)[:200]})
                continue
            if code == 404:
                device.push_endpoint = None
            elif 200 <= code < 300:
                sent += 1
    for subscription in session.scalars(select(PushSubscription).where(PushSubscription.user_id == user_id)):
        try:
            code = send(settings, subscription, content)
        except httpx.HTTPError as error:
            log.warning("Push not sent", extra={"subscription": subscription.id, "error": str(error)[:200]})
            code = 0
        if code in (404, 410):
            session.delete(subscription)
            continue
        if 200 <= code < 300:
            subscription.last_sent_at, subscription.failures = datetime.now(UTC), 0
            sent += 1
        else:
            subscription.failures += 1
            if subscription.failures >= MAX_FAILURES:
                session.delete(subscription)
    return sent


def language_of(session: Session, user_id: int) -> str:
    language = session.scalar(select(UserSettings.language).where(UserSettings.user_id == user_id))
    return language if language in TEXTS else "en"


def push_handler(settings: Settings):  # type: ignore[no-untyped-def]
    """The `push` job."""

    def handle(session: Session, job: Job) -> None:
        kind = str(job.payload.get("kind"))
        content = message(kind, dict(job.payload.get("data") or {}), language_of(session, job.user_id))
        deliver(session, settings, job.user_id, content)

    return handle


def forget(session: Session, user_id: int, endpoint: str) -> None:
    session.execute(
        delete(PushSubscription).where(
            PushSubscription.user_id == user_id, PushSubscription.endpoint == endpoint
        )
    )
