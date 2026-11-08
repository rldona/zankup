"""Sign-in endpoints. Errors never say whether the e-mail, the password or the code was wrong."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from zankup.auth.deps import SESSION_COOKIE, AppSettings, CurrentDevice, CurrentUser, DbSession
from zankup.auth.rate_limit import limiter
from zankup.auth.security import (
    create_access_token,
    create_challenge,
    decrypt_totp_secret,
    new_token,
    read_challenge,
    token_hash,
    verify_password,
    verify_totp,
)
from zankup.db.models import Device, User

router = APIRouter(prefix="/api/auth", tags=["auth"])

WEB_SESSION = timedelta(hours=12)
WEB_REMEMBERED = timedelta(days=30)
APP_REFRESH = timedelta(days=90)
GENERIC_ERROR = "Incorrect e-mail, password or code"


class LoginRequest(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=1024)
    remember: bool = False
    client: Literal["web", "android"] = "web"
    device_name: str = Field(default="Browser", max_length=120)


class Challenge(BaseModel):
    mfa_required: Literal[True] = True
    challenge: str


class TotpRequest(BaseModel):
    challenge: str
    code: str = Field(min_length=6, max_length=8)


class Me(BaseModel):
    id: int
    email: str
    display_name: str | None
    totp_enabled: bool


class AppTokens(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int


class RefreshRequest(BaseModel):
    refresh_token: str


def _secret(settings: AppSettings) -> str | None:
    return settings.jwt_secret.get_secret_value() if settings.jwt_secret else None


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _check_limit(*keys: str) -> None:
    if wait := limiter.retry_after(*keys):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many attempts, try again later",
            {"Retry-After": str(wait)},
        )


def _rejected(*keys: str) -> HTTPException:
    limiter.failure(*keys)
    return HTTPException(status.HTTP_401_UNAUTHORIZED, GENERIC_ERROR)


def _me(user: User) -> Me:
    return Me(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        totp_enabled=user.totp_enabled_at is not None,
    )


@router.post("/login", operation_id="login")
def login(body: LoginRequest, request: Request, db: DbSession, settings: AppSettings) -> Challenge:
    """Step 1: e-mail and password. Returns a challenge to complete with a TOTP code."""
    email = body.email.strip().lower()
    keys = (f"ip:{_client_ip(request)}", f"account:{email}")
    _check_limit(*keys)
    user = db.scalar(select(User).where(User.email == email))
    if not verify_password(user.password_hash if user else None, body.password) or user is None:
        raise _rejected(*keys)
    if user.totp_enabled_at is None or not user.totp_secret_enc:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Two-factor authentication is not set up for this account"
        )
    challenge = create_challenge(
        user.id, _secret(settings), remember=body.remember, client=body.client, device=body.device_name
    )
    return Challenge(challenge=challenge)


@router.post("/login/totp", operation_id="loginTotp")
def login_totp(
    body: TotpRequest, request: Request, response: Response, db: DbSession, settings: AppSettings
) -> Me | AppTokens:
    """Step 2: the 6-digit code. Starts a browser session (cookie) or returns tokens for the app."""
    secret = _secret(settings)
    claims = read_challenge(body.challenge, secret)
    ip_key = f"ip:{_client_ip(request)}"
    _check_limit(ip_key)
    user = db.get(User, int(claims["sub"])) if claims else None
    if claims is None or user is None or not user.totp_secret_enc:
        raise _rejected(ip_key)
    account_key = f"account:{user.email}"
    _check_limit(ip_key, account_key)
    counter = verify_totp(
        decrypt_totp_secret(user.totp_secret_enc, secret), body.code, user.totp_last_counter
    )
    if counter is None:
        raise _rejected(ip_key, account_key)
    user.totp_last_counter = counter
    limiter.success(account_key)
    return start_session(
        db,
        user,
        response,
        settings,
        web=claims.get("client", "web") == "web",
        remember=bool(claims.get("remember")),
        device_name=str(claims.get("device") or "Browser"),
    )


def start_session(
    db: DbSession,
    user: User,
    response: Response,
    settings: AppSettings,
    *,
    web: bool,
    remember: bool,
    device_name: str,
) -> Me | AppTokens:
    """A signed-in device: a session cookie for the browser, or access + refresh tokens for the app.

    Shared by every way of signing in (password + TOTP, passkey and, later, Google).
    """
    token, digest = new_token()
    now = datetime.now(UTC)
    lifetime = (WEB_REMEMBERED if remember else WEB_SESSION) if web else APP_REFRESH
    device = Device(
        user_id=user.id,
        name=device_name[:120] or "Browser",
        platform="web" if web else "android",
        refresh_token_hash=digest,
        last_seen=now,
        expires_at=now + lifetime,
    )
    db.add(device)
    db.commit()
    if web:
        response.set_cookie(
            SESSION_COOKIE,
            token,
            max_age=int(lifetime.total_seconds()) if remember else None,
            httponly=True,
            secure=settings.is_production,
            samesite="lax",
            path="/api",
        )
        return _me(user)
    access = create_access_token(user.id, device.id, _secret(settings))
    return AppTokens(access_token=access, refresh_token=token, expires_in=15 * 60)


@router.post("/refresh", operation_id="refreshTokens")
def refresh(body: RefreshRequest, db: DbSession, settings: AppSettings) -> AppTokens:
    """App only: exchange a refresh token for a new access token and a new refresh token (rotation)."""
    now = datetime.now(UTC)
    device = db.scalar(select(Device).where(Device.refresh_token_hash == token_hash(body.refresh_token)))
    if device is None or device.platform == "web" or (device.expires_at and device.expires_at <= now):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in again")
    token, digest = new_token()
    device.refresh_token_hash, device.expires_at, device.last_seen = digest, now + APP_REFRESH, now
    db.commit()
    access = create_access_token(device.user_id, device.id, _secret(settings))
    return AppTokens(access_token=access, refresh_token=token, expires_in=15 * 60)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, operation_id="logout")
def logout(device: CurrentDevice, response: Response, db: DbSession) -> None:
    """End this session: the device row is deleted, so its cookie or refresh token stops working."""
    db.delete(device)
    db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/api")


@router.get("/me", operation_id="getMe")
def me(user: CurrentUser) -> Me:
    return _me(user)
