"""Password recovery (OS-222).

1. `POST /api/auth/password/forgot` with an e-mail always answers the same, whether or not the account
   exists. If it does, a single-use link valid for 30 minutes is e-mailed (at most one every 60 s).
2. `POST /api/auth/password/reset` with that link's token, the new password and **a code from the
   authenticator app or a recovery code**: someone with access only to the mailbox cannot get in.
   Every session is closed and a notice is e-mailed.

The token is 32 random bytes; only its SHA-256 is stored. Attempts are rate limited per IP and per
account. If everything is lost, the server command `python -m zankup.admin reset-password` remains.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update

from zankup.admin import MIN_PASSWORD, set_password
from zankup.alerts import send_email
from zankup.auth.deps import AppSettings, DbSession
from zankup.auth.rate_limit import limiter
from zankup.auth.recovery import looks_like_recovery_code, use_recovery_code
from zankup.auth.security import decrypt_totp_secret, verify_totp
from zankup.auth.setup import pwned_count
from zankup.db.models import PasswordReset, User, UserSettings

log = logging.getLogger("zankup.password_reset")

router = APIRouter(prefix="/api/auth/password", tags=["auth"])

LINK_TTL = timedelta(minutes=30)
RESEND_EVERY = timedelta(seconds=60)
INVALID_LINK = "This link has expired or was already used: ask for a new one"

EMAILS = {
    "en": {
        "link_subject": "Zankup: reset your password",
        "link": (
            "Someone (hopefully you) asked to reset the password of your Zankup account.\n\n"
            "Open this link within 30 minutes to choose a new one:\n{link}\n\n"
            "You will also need a code from your authenticator app or one of your recovery codes.\n"
            "If it was not you, ignore this e-mail: nothing changes."
        ),
        "done_subject": "Zankup: your password was changed",
        "done": (
            "The password of your Zankup account was changed just now, and every session was "
            "signed out.\n\nIf it was not you, sign in with a recovery code and change it again, and "
            "check who can read your e-mail."
        ),
    },
    "es": {
        "link_subject": "Zankup: restablece tu contraseña",
        "link": (
            "Alguien (esperamos que tú) ha pedido restablecer la contraseña de tu cuenta de Zankup.\n\n"
            "Abre este enlace en los próximos 30 minutos para elegir una nueva:\n{link}\n\n"
            "También necesitarás un código de tu app de autenticación o uno de tus códigos de "
            "recuperación.\nSi no has sido tú, ignora este correo: no cambia nada."
        ),
        "done_subject": "Zankup: tu contraseña ha cambiado",
        "done": (
            "La contraseña de tu cuenta de Zankup acaba de cambiar y se han cerrado todas las "
            "sesiones.\n\nSi no has sido tú, entra con un código de recuperación, cámbiala otra vez y "
            "revisa quién puede leer tu correo."
        ),
    },
}


class ForgotRequest(BaseModel):
    email: str = Field(max_length=320)


class ResetRequest(BaseModel):
    token: str = Field(max_length=128)
    password: str = Field(max_length=1024)
    code: str = Field(default="", max_length=16, description="Authenticator code or a recovery code")


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _too_many(*keys: str) -> None:
    if wait := limiter.retry_after(*keys):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts", {"Retry-After": str(wait)}
        )


def _language(db: DbSession, user: User) -> str:
    language = db.scalar(select(UserSettings.language).where(UserSettings.user_id == user.id))
    return language if language in EMAILS else "en"


def _origin(settings: AppSettings) -> str:
    return (settings.webauthn_origins[0] if settings.webauthn_origins else "http://localhost:5173").rstrip(
        "/"
    )


@router.post("/forgot", status_code=status.HTTP_202_ACCEPTED, operation_id="forgotPassword")
def forgot(body: ForgotRequest, request: Request, db: DbSession, settings: AppSettings) -> Response:
    """E-mail a recovery link. The answer is the same whether or not the account exists."""
    ip_key = f"forgot:{_ip(request)}"
    _too_many(ip_key)
    limiter.failure(ip_key)  # every request counts: this endpoint sends e-mail
    email = body.email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    now = datetime.now(UTC)
    if user is not None:
        last = db.scalar(
            select(PasswordReset.created_at)
            .where(PasswordReset.user_id == user.id)
            .order_by(PasswordReset.created_at.desc())
            .limit(1)
        )
        if last is None or now - last >= RESEND_EVERY:
            token = secrets.token_urlsafe(32)
            db.add(PasswordReset(user_id=user.id, token_hash=_digest(token), expires_at=now + LINK_TTL))
            db.commit()
            texts = EMAILS[_language(db, user)]
            link = f"{_origin(settings)}/reset-password?token={token}"
            send_email(settings, user.email, texts["link_subject"], texts["link"].format(link=link))
            log.info("Password recovery link sent", extra={"user_id": user.id})
    return Response(status_code=status.HTTP_202_ACCEPTED)


@router.post("/reset", status_code=status.HTTP_204_NO_CONTENT, operation_id="resetPassword")
def reset(body: ResetRequest, request: Request, db: DbSession, settings: AppSettings) -> Response:
    """Choose a new password with the link's token and a code. Signs every session out."""
    ip_key = f"reset:{_ip(request)}"
    _too_many(ip_key)
    now = datetime.now(UTC)
    link = db.scalar(select(PasswordReset).where(PasswordReset.token_hash == _digest(body.token)))
    if link is None or link.used_at is not None or link.expires_at <= now:
        limiter.failure(ip_key)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID_LINK)
    user = db.get_one(User, link.user_id)
    account_key = f"account:{user.email}"
    _too_many(ip_key, account_key)

    # The password first, so a rejected one never spends a recovery code.
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
    if user.totp_secret_enc and user.totp_enabled_at:
        secret = settings.jwt_secret.get_secret_value() if settings.jwt_secret else None
        if looks_like_recovery_code(body.code):
            accepted = use_recovery_code(db, user, body.code)
        else:
            counter = verify_totp(
                decrypt_totp_secret(user.totp_secret_enc, secret), body.code, user.totp_last_counter
            )
            accepted = counter is not None
            if counter is not None:
                user.totp_last_counter = counter
        if not accepted:
            limiter.failure(ip_key, account_key)
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That code does not match")

    set_password(db, user, body.password)  # also signs every session out
    db.execute(
        update(PasswordReset)
        .where(PasswordReset.user_id == user.id, PasswordReset.used_at.is_(None))
        .values(used_at=now)
    )
    db.commit()
    limiter.success(account_key)
    texts = EMAILS[_language(db, user)]
    send_email(settings, user.email, texts["done_subject"], texts["done"])
    log.info("Password reset", extra={"user_id": user.id})
    return Response(status_code=status.HTTP_204_NO_CONTENT)
