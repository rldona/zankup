"""Password hashing, TOTP, opaque session tokens and signed short-lived tokens."""

from __future__ import annotations

import base64
import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

ISSUER = "Zankup"
ACCESS_TTL = timedelta(minutes=15)
CHALLENGE_TTL = timedelta(minutes=5)
SETUP_TTL = timedelta(minutes=30)
_hasher = PasswordHasher()  # Argon2id with the library's current recommended parameters


class AuthConfigError(RuntimeError):
    """JWT_SECRET is missing: sessions and TOTP secrets cannot be protected."""


# --- passwords -----------------------------------------------------------------------------------


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    if not password_hash:
        _hasher.hash(password)  # same cost as a real check: timing does not reveal unknown accounts
        return False
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


# --- secrets derived from JWT_SECRET -------------------------------------------------------------


def _key(secret: str | None, purpose: bytes) -> bytes:
    if not secret:
        raise AuthConfigError("JWT_SECRET is not set")
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=purpose).derive(secret.encode())


def encrypt_totp_secret(totp_secret: str, jwt_secret: str | None) -> str:
    fernet = Fernet(base64.urlsafe_b64encode(_key(jwt_secret, b"zankup-totp")))
    return fernet.encrypt(totp_secret.encode()).decode()


def decrypt_totp_secret(encrypted: str, jwt_secret: str | None) -> str:
    fernet = Fernet(base64.urlsafe_b64encode(_key(jwt_secret, b"zankup-totp")))
    try:
        return fernet.decrypt(encrypted.encode()).decode()
    except InvalidToken as error:
        raise AuthConfigError("The TOTP secret cannot be decrypted: was JWT_SECRET changed?") from error


# --- TOTP -----------------------------------------------------------------------------------------


def new_totp_secret() -> str:
    return pyotp.random_base32()


def totp_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=ISSUER)


def verify_totp(secret: str, code: str, last_counter: int | None, now: datetime | None = None) -> int | None:
    """The accepted time step, or None. Accepts the previous, current and next step; never a reused one."""
    totp, now = pyotp.TOTP(secret), now or datetime.now(UTC)
    code = code.strip().replace(" ", "")
    current = totp.timecode(now)
    for counter in (current - 1, current, current + 1):
        if last_counter is not None and counter <= last_counter:
            continue
        if secrets.compare_digest(totp.generate_otp(counter), code):
            return counter
    return None


# --- opaque tokens (browser session, refresh token) ----------------------------------------------


def new_token() -> tuple[str, str]:
    """(token for the client, SHA-256 to store)."""
    token = secrets.token_urlsafe(32)
    return token, token_hash(token)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# --- signed tokens (app access token, sign-in challenge) -----------------------------------------


def _sign(claims: dict[str, Any], secret: str | None, ttl: timedelta) -> str:
    now = datetime.now(UTC)
    payload = {**claims, "iat": now, "exp": now + ttl, "iss": ISSUER}
    return jwt.encode(payload, _key(secret, b"zankup-jwt"), algorithm="HS256")


def _verify(token: str, secret: str | None, purpose: str) -> dict[str, Any] | None:
    try:
        claims: dict[str, Any] = jwt.decode(
            token, _key(secret, b"zankup-jwt"), algorithms=["HS256"], issuer=ISSUER
        )
    except jwt.PyJWTError:
        return None
    return claims if claims.get("purpose") == purpose else None


def create_access_token(user_id: int, device_id: int, secret: str | None) -> str:
    return _sign({"purpose": "access", "sub": str(user_id), "did": device_id}, secret, ACCESS_TTL)


def read_access_token(token: str, secret: str | None) -> tuple[int, int] | None:
    claims = _verify(token, secret, "access")
    return (int(claims["sub"]), int(claims["did"])) if claims else None


def create_challenge(user_id: int, secret: str | None, **extra: Any) -> str:
    """Proof that the password was right, valid for 5 minutes, to be exchanged with a TOTP code."""
    return _sign({"purpose": "mfa", "sub": str(user_id), **extra}, secret, CHALLENGE_TTL)


def read_challenge(token: str, secret: str | None) -> dict[str, Any] | None:
    return _verify(token, secret, "mfa")


def create_setup_token(user_id: int, secret: str | None) -> str:
    """Proof that sign-up step 1 (setup code + password) was done, for the TOTP step that follows."""
    return _sign({"purpose": "setup", "sub": str(user_id)}, secret, SETUP_TTL)


def read_setup_token(token: str, secret: str | None) -> int | None:
    claims = _verify(token, secret, "setup")
    return int(claims["sub"]) if claims else None


def encrypt_secret(value: str, jwt_secret: str | None, purpose: bytes) -> str:
    return Fernet(base64.urlsafe_b64encode(_key(jwt_secret, purpose))).encrypt(value.encode()).decode()


def decrypt_secret(encrypted: str, jwt_secret: str | None, purpose: bytes) -> str:
    try:
        return Fernet(base64.urlsafe_b64encode(_key(jwt_secret, purpose))).decrypt(encrypted).decode()
    except InvalidToken as error:
        raise AuthConfigError("Cannot decrypt: JWT_SECRET changed") from error
