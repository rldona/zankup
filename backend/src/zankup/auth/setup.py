"""First-time sign-up (OS-221): one instance, one account, created from the browser.

While nobody has finished signing up, the server keeps a **setup code**: it is generated on the first
start and written to the logs on every start (Railway → Deployments → Logs), so only whoever runs the
instance can create its account, even if someone else finds the URL first.

1. `POST /api/setup/account`: setup code, name, e-mail and password (12+ characters, not in a known
   breach). Takes over the owner account, so activities already synced stay. Returns a setup token and
   the TOTP key with its QR code.
2. `POST /api/setup/totp`: a code from the authenticator app. Turns two-step verification on, creates
   8 single-use recovery codes, deletes the setup code (sign-up closes) and signs the browser in.

Sign-up is open while no user has two-step verification enabled.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from datetime import UTC, datetime

import httpx
import segno
from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, exists, select
from sqlalchemy.orm import Session

from zankup.admin import MIN_PASSWORD, AdminError, set_password
from zankup.auth.deps import AppSettings, DbSession
from zankup.auth.rate_limit import limiter
from zankup.auth.recovery import new_recovery_codes
from zankup.auth.routes import Me, start_session
from zankup.auth.security import (
    create_setup_token,
    decrypt_secret,
    decrypt_totp_secret,
    encrypt_secret,
    encrypt_totp_secret,
    new_totp_secret,
    read_setup_token,
    totp_uri,
    verify_totp,
)
from zankup.db.models import SetupCode, User
from zankup.users import ensure_owner

log = logging.getLogger("zankup.setup")

router = APIRouter(prefix="/api/setup", tags=["auth"])

CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I/L: read from a log, typed by hand
PWNED_URL = "https://api.pwnedpasswords.com/range/"
CLOSED = "Sign-up is closed: this instance already has its account"


# --- setup code ------------------------------------------------------------------------------------


def sign_up_open(db: Session) -> bool:
    return not db.scalar(select(exists().where(User.totp_enabled_at.is_not(None))))


def _normalise(code: str) -> str:
    return "".join(c for c in code.upper() if c.isalnum())


def _digest(code: str) -> str:
    return hashlib.sha256(_normalise(code).encode()).hexdigest()


def ensure_setup_code(db: Session, jwt_secret: str | None) -> str | None:
    """While sign-up is open, the setup code (created on first use). None once it is closed."""
    if not sign_up_open(db):
        db.execute(delete(SetupCode))
        return None
    row = db.get(SetupCode, 1)
    if row is not None:
        return decrypt_secret(row.code_enc, jwt_secret, b"zankup-setup-code")
    raw = "".join(secrets.choice(CODE_ALPHABET) for _ in range(12))
    code = f"{raw[:4]}-{raw[4:8]}-{raw[8:]}"
    db.add(
        SetupCode(
            id=1, code_hash=_digest(code), code_enc=encrypt_secret(code, jwt_secret, b"zankup-setup-code")
        )
    )
    return code


def announce_setup_code(db: Session, jwt_secret: str | None) -> None:
    """On start: put the setup code in the logs while sign-up is open."""
    code = ensure_setup_code(db, jwt_secret)
    db.commit()
    if code:
        log.warning(
            "Sign-up is open. Create your account at /setup with this setup code: %s",
            code,
            extra={"setup_code": code},
        )


def _check_code(db: Session, code: str) -> bool:
    row = db.get(SetupCode, 1)
    return row is not None and hmac.compare_digest(row.code_hash, _digest(code))


# --- passwords in known breaches -------------------------------------------------------------------


def pwned_count(password: str) -> int | None:
    """How many times the password appears in Have I Been Pwned, by k-anonymity: only the first 5
    characters of its SHA-1 leave the server. None when the service cannot be reached (not blocking)."""
    digest = hashlib.sha1(password.encode(), usedforsecurity=False).hexdigest().upper()
    try:
        response = httpx.get(PWNED_URL + digest[:5], headers={"Add-Padding": "true"}, timeout=3)
        response.raise_for_status()
    except httpx.HTTPError:
        log.warning("Could not check the password against Have I Been Pwned")
        return None
    for line in response.text.splitlines():
        suffix, _, count = line.partition(":")
        if suffix.strip() == digest[5:]:
            return int(count.strip() or 0)
    return 0


# --- endpoints -------------------------------------------------------------------------------------


class SetupStatus(BaseModel):
    open: bool


class AccountRequest(BaseModel):
    code: str = Field(max_length=40, description="The setup code from the server logs")
    display_name: str = Field(min_length=1, max_length=120)
    email: str = Field(max_length=320)
    password: str = Field(max_length=1024)
    accept: bool = Field(description="Accepts how the data is handled")


class TotpSetup(BaseModel):
    setup_token: str
    secret: str = Field(description="Key to type into the authenticator app")
    uri: str = Field(description="otpauth:// link with the same key")
    qr_svg: str = Field(description="The link as a QR code (SVG)")


class TotpConfirm(BaseModel):
    setup_token: str
    code: str = Field(min_length=6, max_length=8)


class SetupDone(BaseModel):
    me: Me
    recovery_codes: list[str]


def _secret(settings: AppSettings) -> str | None:
    return settings.jwt_secret.get_secret_value() if settings.jwt_secret else None


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _closed() -> HTTPException:
    return HTTPException(status.HTTP_410_GONE, CLOSED)


@router.get("", operation_id="getSetupStatus")
def setup_status(db: DbSession) -> SetupStatus:
    return SetupStatus(open=sign_up_open(db))


@router.post("/account", operation_id="setupAccount")
def setup_account(body: AccountRequest, request: Request, db: DbSession, settings: AppSettings) -> TotpSetup:
    """Step 1: setup code, name, e-mail and password. Returns the TOTP key for step 2."""
    if not sign_up_open(db):
        raise _closed()
    key = f"setup:{_ip(request)}"
    if wait := limiter.retry_after(key):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts", {"Retry-After": str(wait)}
        )
    if not _check_code(db, body.code):
        limiter.failure(key)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That setup code is not right")
    if not body.accept:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Accept how your data is handled to continue"
        )
    email = body.email.strip().lower()
    if "@" not in email or "." not in email.rsplit("@", 1)[-1]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Enter a valid e-mail")
    if len(body.password) < MIN_PASSWORD:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"The password must have at least {MIN_PASSWORD} characters",
        )
    if (pwned_count(body.password) or 0) > 0:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "This password appears in known data breaches: choose another one",
        )

    user = ensure_owner(db, email)
    user.email, user.display_name = email, body.display_name.strip()
    try:
        set_password(db, user, body.password)
    except AdminError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(error)) from None
    totp_secret = new_totp_secret()
    user.totp_secret_enc = encrypt_totp_secret(totp_secret, _secret(settings))  # pending until verified
    user.totp_enabled_at, user.totp_last_counter = None, None
    db.commit()
    limiter.success(key)
    uri = totp_uri(totp_secret, email)
    return TotpSetup(
        setup_token=create_setup_token(user.id, _secret(settings)),
        secret=totp_secret,
        uri=uri,
        qr_svg=segno.make(uri, error="m").svg_inline(scale=5, border=2, dark="#000", light="#fff"),
    )


@router.post("/totp", operation_id="setupTotp")
def setup_totp(
    body: TotpConfirm, request: Request, response: Response, db: DbSession, settings: AppSettings
) -> SetupDone:
    """Step 2: a code from the app turns two-step verification on, closes sign-up and signs in."""
    if not sign_up_open(db):
        raise _closed()
    key = f"setup:{_ip(request)}"
    if wait := limiter.retry_after(key):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts", {"Retry-After": str(wait)}
        )
    user_id = read_setup_token(body.setup_token, _secret(settings))
    user = db.get(User, user_id) if user_id else None
    if user is None or not user.totp_secret_enc:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "That took too long: start again with the setup code"
        )
    counter = verify_totp(decrypt_totp_secret(user.totp_secret_enc, _secret(settings)), body.code, None)
    if counter is None:
        limiter.failure(key)
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "That code does not match: check the app's clock and try the next one",
        )
    user.totp_enabled_at, user.totp_last_counter = datetime.now(UTC), counter
    codes = new_recovery_codes(db, user)
    db.execute(delete(SetupCode))
    limiter.success(key)
    log.info("Sign-up finished: the instance has its account")
    me = start_session(db, user, response, settings, web=True, remember=False, device_name="Browser")
    assert isinstance(me, Me)
    return SetupDone(me=me, recovery_codes=codes)
