"""Passkeys (OS-405): WebAuthn registration, sign-in and management.

- Registering needs a signed-in session: a passkey is added from Profile → Sign-in methods.
- Signing in with a passkey replaces both the password and the TOTP code: the authenticator already
  proves two factors (the device, and the fingerprint, face or PIN that unlocks it), so user
  verification is required. It starts the same session as the other methods.
- Passkeys are discoverable ("resident"): the browser offers them without typing an e-mail.
- Every challenge is stored and deleted when used, so a captured response cannot be replayed.
- They are bound to WEBAUTHN_RP_ID (zankup.com in production). Changing it invalidates every passkey.
"""

from __future__ import annotations

import json
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes
from webauthn.helpers.exceptions import InvalidAuthenticationResponse, InvalidRegistrationResponse
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    AuthenticatorTransport,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from zankup.auth.deps import AppSettings, CurrentUser, DbSession
from zankup.auth.rate_limit import limiter
from zankup.auth.routes import AppTokens, Me, start_session
from zankup.db.models import Passkey, User, WebAuthnChallenge

router = APIRouter(prefix="/api/auth/passkeys", tags=["auth"])

CHALLENGE_TTL = timedelta(minutes=5)
GENERIC_ERROR = "This passkey could not be used"


class PasskeyOut(BaseModel):
    id: int
    name: str
    created_at: datetime
    last_used_at: datetime | None
    backed_up: bool = Field(description="Synced by a password manager (Google, iCloud…)")


class Options(BaseModel):
    """`publicKey` options for navigator.credentials.create() or .get(), as JSON (binary as base64url)."""

    options: dict[str, Any]


class RegisterRequest(BaseModel):
    credential: dict[str, Any] = Field(description="The PublicKeyCredential, serialised with toJSON()")
    name: str = Field(default="Passkey", max_length=120)


class LoginRequest(BaseModel):
    credential: dict[str, Any]
    remember: bool = False
    client: Literal["web", "android"] = "web"
    device_name: str = Field(default="Browser", max_length=120)


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _store_challenge(db: DbSession, purpose: str, user_id: int | None) -> bytes:
    now = datetime.now(UTC)
    db.execute(delete(WebAuthnChallenge).where(WebAuthnChallenge.expires_at < now))
    challenge = secrets.token_bytes(32)
    db.add(
        WebAuthnChallenge(
            challenge=challenge, purpose=purpose, user_id=user_id, expires_at=now + CHALLENGE_TTL
        )
    )
    db.commit()
    return challenge


def _take_challenge(db: DbSession, credential: dict[str, Any], purpose: str) -> WebAuthnChallenge | None:
    """The stored challenge this response answers, removed so it can only be used once."""
    try:
        client_data = json.loads(base64url_to_bytes(credential["response"]["clientDataJSON"]))
        challenge = base64url_to_bytes(client_data["challenge"])
    except (KeyError, TypeError, ValueError):
        return None
    stored = db.get(WebAuthnChallenge, challenge)
    if stored is None or stored.purpose != purpose:
        return None
    db.delete(stored)
    db.commit()
    return stored if stored.expires_at > datetime.now(UTC) else None


def _options(raw: Any) -> Options:
    return Options(options=json.loads(options_to_json(raw)))


@router.get("", operation_id="listPasskeys")
def list_passkeys(db: DbSession, user: CurrentUser) -> list[PasskeyOut]:
    passkeys = db.scalars(select(Passkey).where(Passkey.user_id == user.id).order_by(Passkey.created_at))
    return [PasskeyOut.model_validate(p, from_attributes=True) for p in passkeys]


@router.post("/register/options", operation_id="passkeyRegisterOptions")
def register_options(db: DbSession, user: CurrentUser, settings: AppSettings) -> Options:
    """Step 1 of adding a passkey: options for navigator.credentials.create()."""
    existing = db.scalars(select(Passkey).where(Passkey.user_id == user.id))
    challenge = _store_challenge(db, "register", user.id)
    return _options(
        generate_registration_options(
            rp_id=settings.webauthn_rp_id,
            rp_name="Zankup",
            user_id=str(user.id).encode(),
            user_name=user.email,
            user_display_name=user.display_name or user.email,
            challenge=challenge,
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.REQUIRED,
                user_verification=UserVerificationRequirement.REQUIRED,
            ),
            exclude_credentials=[PublicKeyCredentialDescriptor(id=p.credential_id) for p in existing],
        )
    )


@router.post("/register", status_code=status.HTTP_201_CREATED, operation_id="passkeyRegister")
def register(body: RegisterRequest, db: DbSession, user: CurrentUser, settings: AppSettings) -> PasskeyOut:
    """Step 2: verify the new credential and keep its public key."""
    stored = _take_challenge(db, body.credential, "register")
    if stored is None or stored.user_id != user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The request expired, try again")
    try:
        verified = verify_registration_response(
            credential=body.credential,
            expected_challenge=stored.challenge,
            expected_rp_id=settings.webauthn_rp_id,
            expected_origin=settings.webauthn_origins,
            require_user_verification=True,
        )
    except InvalidRegistrationResponse:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The passkey could not be verified") from None
    if db.scalar(select(Passkey.id).where(Passkey.credential_id == verified.credential_id)):
        raise HTTPException(status.HTTP_409_CONFLICT, "This passkey is already registered")
    transports = body.credential.get("response", {}).get("transports")
    passkey = Passkey(
        user_id=user.id,
        credential_id=verified.credential_id,
        public_key=verified.credential_public_key,
        sign_count=verified.sign_count,
        transports=[t for t in transports if t in {x.value for x in AuthenticatorTransport}]
        if isinstance(transports, list)
        else None,
        aaguid=verified.aaguid or None,
        backed_up=verified.credential_backed_up,
        name=body.name.strip() or "Passkey",
    )
    db.add(passkey)
    db.commit()
    return PasskeyOut.model_validate(passkey, from_attributes=True)


@router.delete("/{passkey_id}", status_code=status.HTTP_204_NO_CONTENT, operation_id="deletePasskey")
def delete_passkey(passkey_id: int, db: DbSession, user: CurrentUser) -> None:
    passkey = db.scalar(select(Passkey).where(Passkey.id == passkey_id, Passkey.user_id == user.id))
    if passkey is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Passkey not found")
    db.delete(passkey)
    db.commit()


@router.post("/login/options", operation_id="passkeyLoginOptions")
def login_options(request: Request, db: DbSession, settings: AppSettings) -> Options:
    """Step 1 of signing in: options for navigator.credentials.get(). No e-mail needed."""
    if wait := limiter.retry_after(f"ip:{_client_ip(request)}"):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts", {"Retry-After": str(wait)}
        )
    challenge = _store_challenge(db, "login", None)
    return _options(
        generate_authentication_options(
            rp_id=settings.webauthn_rp_id,
            challenge=challenge,
            user_verification=UserVerificationRequirement.REQUIRED,
        )
    )


@router.post("/login", operation_id="passkeyLogin")
def login(
    body: LoginRequest, request: Request, response: Response, db: DbSession, settings: AppSettings
) -> Me | AppTokens:
    """Step 2: verify the signature and start a session, like password + TOTP would."""
    ip_key = f"ip:{_client_ip(request)}"
    if wait := limiter.retry_after(ip_key):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts", {"Retry-After": str(wait)}
        )

    def rejected() -> HTTPException:
        limiter.failure(ip_key)
        return HTTPException(status.HTTP_401_UNAUTHORIZED, GENERIC_ERROR)

    stored = _take_challenge(db, body.credential, "login")
    try:
        credential_id = base64url_to_bytes(str(body.credential.get("rawId") or body.credential.get("id")))
    except (TypeError, ValueError):
        raise rejected() from None
    passkey = db.scalar(select(Passkey).where(Passkey.credential_id == credential_id))
    if stored is None or passkey is None:
        raise rejected()
    try:
        verified = verify_authentication_response(
            credential=body.credential,
            expected_challenge=stored.challenge,
            expected_rp_id=settings.webauthn_rp_id,
            expected_origin=settings.webauthn_origins,
            credential_public_key=passkey.public_key,
            credential_current_sign_count=passkey.sign_count,
            require_user_verification=True,
        )
    except InvalidAuthenticationResponse:
        raise rejected() from None
    user = db.get(User, passkey.user_id)
    if user is None:
        raise rejected()
    passkey.sign_count = verified.new_sign_count
    passkey.backed_up = verified.credential_backed_up
    passkey.last_used_at = datetime.now(UTC)
    limiter.success(ip_key)
    return start_session(
        db,
        user,
        response,
        settings,
        web=body.client == "web",
        remember=body.remember,
        device_name=body.device_name,
    )
