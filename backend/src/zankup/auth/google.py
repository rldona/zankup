"""Sign-in with a Google account (OS-220): OpenID Connect, authorization code flow with PKCE, `state`
and `nonce`, asking only for `openid email profile`.

- `GET /api/auth/google/start?mode=login|link&next=/…` sends the browser to Google. The PKCE verifier,
  state, nonce and where to go back are kept in a short-lived signed cookie.
- `GET /api/auth/google/callback` exchanges the code, validates the ID token (signature with Google's
  keys, issuer, audience, expiry, nonce, `email_verified`) and then:
  - `link` (signed in): links that Google account to the user;
  - `login`: signs in **only the user linked to that Google `sub`**. Anyone else gets the same generic
    rejection. No TOTP code is asked: Google applies its own two-step verification.
- `DELETE /api/auth/google` unlinks it, if another strong method remains (password with TOTP, or a
  passkey).

The Android app (OS-503) signs in natively with Credential Manager instead:
- `GET /api/auth/google/mobile/nonce` gives a nonce and a signed `state` holding it (5 minutes);
- the app asks Google for an ID token for this instance's (web) client ID with that nonce, and sends it
  with the state to `POST /api/auth/google/mobile`, which checks it like the callback does and, for the
  linked user only, returns the app's access and refresh tokens.
- Google's classic Android SDK (the free sign-in library) cannot set a nonce: without a state the token
  must have been issued in the last five minutes and is accepted only once. The app no longer uses it
  (it returned the same cached token on the next sign-in), but older builds still can.

Each instance has its own OAuth client (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET), with
`<origin>/api/auth/google/callback` as its redirect URI.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from zankup.auth.deps import AppSettings, CurrentUser, DbSession, current_device, current_user
from zankup.auth.routes import AppTokens, start_session
from zankup.db.models import Passkey, User
from zankup.next import safe_next

log = logging.getLogger("zankup.google")

router = APIRouter(prefix="/api/auth/google", tags=["auth"])

AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"
ISSUERS = ("https://accounts.google.com", "accounts.google.com")
COOKIE = "zankup_google"
COOKIE_PATH = "/api/auth/google"
FLOW_TTL = timedelta(minutes=10)


class Providers(BaseModel):
    google: bool
    google_client_id: str | None = Field(
        default=None, description="Public: the Android app asks Google for ID tokens for this client"
    )
    dev_login: bool = Field(default=False, description="Development only: one-click sign-in is on")


def _configured(settings: AppSettings) -> tuple[str, str]:
    if not settings.google_client_id or settings.google_client_secret is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Google sign-in is not configured on this instance")
    return settings.google_client_id, settings.google_client_secret.get_secret_value()


def _origin(settings: AppSettings) -> str:
    return (settings.webauthn_origins[0] if settings.webauthn_origins else "http://localhost:5173").rstrip(
        "/"
    )


def _redirect_uri(settings: AppSettings) -> str:
    return f"{_origin(settings)}/api/auth/google/callback"


def _key(settings: AppSettings) -> str:
    secret = settings.jwt_secret.get_secret_value() if settings.jwt_secret else "dev-only"
    return hashlib.sha256(f"zankup-google-flow:{secret}".encode()).hexdigest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _signed_in(request: Request, db: DbSession, settings: AppSettings) -> User:
    """The signed-in user (raises 401 otherwise), for routes that are public in other modes."""
    return current_user(current_device(request, db, settings), db)


def _back(settings: AppSettings, path: str) -> RedirectResponse:
    response = RedirectResponse(f"{_origin(settings)}{path}", status.HTTP_303_SEE_OTHER)
    response.delete_cookie(COOKIE, path=COOKIE_PATH)
    return response


@router.get("/providers", operation_id="authProviders")
def providers(settings: AppSettings) -> Providers:
    """Which extra sign-in methods this instance offers (public: the sign-in screen asks)."""
    enabled = bool(settings.google_client_id and settings.google_client_secret)
    return Providers(
        google=enabled,
        google_client_id=settings.google_client_id if enabled else None,
        dev_login=settings.dev_login and not settings.is_production,
    )


@router.get("/start", operation_id="googleStart", response_class=RedirectResponse, status_code=303)
def start(
    request: Request,
    db: DbSession,
    settings: AppSettings,
    mode: Literal["login", "link"] = "login",
    next: str = Query("/", max_length=512),
) -> RedirectResponse:
    """Off to Google. `link` needs a signed-in session (Profile → Account → Sign-in methods)."""
    client_id, _ = _configured(settings)
    if mode == "link":
        _signed_in(request, db, settings)  # raises 401 when signed out
    verifier, state, nonce = secrets.token_urlsafe(48), secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    challenge = _b64(hashlib.sha256(verifier.encode()).digest())
    flow = jwt.encode(
        {
            "verifier": verifier,
            "state": state,
            "nonce": nonce,
            "mode": mode,
            "next": safe_next(next),
            "exp": datetime.now(UTC) + FLOW_TTL,
        },
        _key(settings),
        algorithm="HS256",
    )
    query = urlencode(
        {
            "client_id": client_id,
            "redirect_uri": _redirect_uri(settings),
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "nonce": nonce,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "prompt": "select_account",
        }
    )
    response = RedirectResponse(f"{AUTHORIZE_URL}?{query}", status.HTTP_303_SEE_OTHER)
    response.set_cookie(
        COOKIE,
        flow,
        max_age=int(FLOW_TTL.total_seconds()),
        httponly=True,
        secure=settings.is_production,
        samesite="lax",  # sent on Google's redirect back (a top-level GET)
        path=COOKIE_PATH,
    )
    return response


def verify_id_token(
    token: str, client_id: str, nonce: str | None, http: httpx.Client | None = None
) -> dict[str, Any]:
    """The ID token's claims, after checking signature, issuer, audience, expiry, nonce and that the
    e-mail is verified. Raises ValueError otherwise."""
    try:
        header = jwt.get_unverified_header(token)
        keys = (http or httpx).get(CERTS_URL, timeout=10).json()["keys"]
        key = next(k for k in keys if k.get("kid") == header.get("kid"))
        claims: dict[str, Any] = jwt.decode(
            token,
            jwt.PyJWK.from_json(json.dumps(key)).key,
            algorithms=["RS256"],
            audience=client_id,
            issuer=list(ISSUERS),
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )
    except (StopIteration, KeyError, jwt.PyJWTError, httpx.HTTPError) as error:
        raise ValueError(f"Invalid ID token: {error.__class__.__name__}") from None
    if nonce is not None and claims.get("nonce") != nonce:
        raise ValueError("Invalid ID token: nonce")
    if claims.get("email_verified") is not True:
        raise ValueError("Invalid ID token: e-mail not verified")
    return claims


@router.get("/callback", operation_id="googleCallback", response_class=RedirectResponse, status_code=303)
def callback(
    request: Request,
    db: DbSession,
    settings: AppSettings,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    """Back from Google: link the account, or sign in the one linked to it."""
    client_id, client_secret = _configured(settings)
    try:
        flow = jwt.decode(request.cookies.get(COOKIE, ""), _key(settings), algorithms=["HS256"])
    except jwt.PyJWTError:
        return _back(settings, "/sign-in?error=google")
    failed = "/profile?tab=account&google=error" if flow["mode"] == "link" else "/sign-in?error=google"
    if error or not code or not state or not secrets.compare_digest(state, flow["state"]):
        return _back(settings, failed)
    try:
        tokens = httpx.post(
            TOKEN_URL,
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": _redirect_uri(settings),
                "grant_type": "authorization_code",
                "code_verifier": flow["verifier"],
            },
            timeout=10,
        )
        tokens.raise_for_status()
        claims = verify_id_token(tokens.json()["id_token"], client_id, flow["nonce"])
    except (httpx.HTTPError, KeyError, ValueError) as problem:
        log.warning("Google sign-in rejected", extra={"reason": str(problem)[:200]})
        return _back(settings, failed)

    sub = str(claims["sub"])
    if flow["mode"] == "link":
        try:
            user = _signed_in(request, db, settings)
        except HTTPException:
            return _back(settings, "/sign-in?error=google")
        if db.scalar(select(User.id).where(User.google_sub == sub, User.id != user.id)):
            return _back(settings, failed)
        user.google_sub = sub
        take_profile(user, claims)
        db.commit()
        log.info("Google account linked", extra={"user_id": user.id})
        return _back(settings, "/profile?tab=account&google=linked")

    linked = db.scalar(select(User).where(User.google_sub == sub))
    if linked is None:
        log.info("Google sign-in for an account that is not linked")
        return _back(settings, "/sign-in?error=google")
    take_profile(linked, claims)
    response = _back(settings, flow["next"])
    start_session(db, linked, response, settings, web=True, remember=True, device_name="Browser (Google)")
    return response


def take_profile(user: User, claims: dict[str, Any]) -> None:
    """Keep the Google account's photo up to date, and its name when the profile has none yet: a name
    the person chose is never overwritten."""
    picture = claims.get("picture")
    if isinstance(picture, str) and picture.startswith("https://") and len(picture) <= 500:
        user.avatar_url = picture
    name = claims.get("name")
    if not user.display_name and isinstance(name, str) and name.strip():
        user.display_name = name.strip()[:120]


FRESH_TOKEN = timedelta(minutes=5)
_used_tokens: dict[str, float] = {}


def _use_once(token: str) -> None:
    """Refuse an ID token seen before (kept in memory for as long as it could still be fresh)."""
    now = datetime.now(UTC).timestamp()
    for digest, seen in list(_used_tokens.items()):
        if now - seen > FRESH_TOKEN.total_seconds() * 2:
            del _used_tokens[digest]
    digest = hashlib.sha256(token.encode()).hexdigest()
    if digest in _used_tokens:
        raise ValueError("Invalid ID token: already used")
    _used_tokens[digest] = now


class MobileNonce(BaseModel):
    nonce: str
    state: str


class MobileSignIn(BaseModel):
    id_token: str = Field(max_length=8192)
    state: str | None = Field(
        default=None, max_length=2048, description="From /mobile/nonce, when the token carries that nonce"
    )
    device_name: str = Field(default="Android", max_length=120)


@router.get("/mobile/nonce", operation_id="googleMobileNonce")
def mobile_nonce(settings: AppSettings) -> MobileNonce:
    """A nonce for the app's native Google sign-in, and the signed state to send back with the token."""
    _configured(settings)
    nonce = secrets.token_urlsafe(24)
    state = jwt.encode(
        {"purpose": "google-mobile", "nonce": nonce, "exp": datetime.now(UTC) + timedelta(minutes=5)},
        _key(settings),
        algorithm="HS256",
    )
    return MobileNonce(nonce=nonce, state=state)


@router.post("/mobile", operation_id="googleMobileSignIn")
def mobile_sign_in(body: MobileSignIn, response: Response, db: DbSession, settings: AppSettings) -> AppTokens:
    """The app's native Google sign-in: tokens for the user linked to that Google account, or 401."""
    client_id, _ = _configured(settings)
    rejected = HTTPException(status.HTTP_401_UNAUTHORIZED, "This Google account cannot sign in here")
    try:
        nonce = None
        if body.state is not None:
            state = jwt.decode(body.state, _key(settings), algorithms=["HS256"])
            if state.get("purpose") != "google-mobile":
                raise ValueError("state")
            nonce = str(state["nonce"])
        claims = verify_id_token(body.id_token, client_id, nonce)
        if nonce is None:
            # Google's classic Android SDK cannot carry a nonce: the token must be fresh and is used once.
            if datetime.now(UTC).timestamp() - float(claims.get("iat", 0)) > FRESH_TOKEN.total_seconds():
                raise ValueError("Invalid ID token: not fresh")
            _use_once(body.id_token)
    except (jwt.PyJWTError, KeyError, ValueError) as problem:
        log.warning("Google mobile sign-in rejected", extra={"reason": str(problem)[:200]})
        raise rejected from None
    linked = db.scalar(select(User).where(User.google_sub == str(claims["sub"])))
    if linked is None:
        log.info("Google mobile sign-in for an account that is not linked")
        raise rejected
    take_profile(linked, claims)
    tokens = start_session(
        db, linked, response, settings, web=False, remember=True, device_name=body.device_name
    )
    assert isinstance(tokens, AppTokens)
    return tokens


@router.delete("", status_code=status.HTTP_204_NO_CONTENT, operation_id="googleUnlink")
def unlink(user: CurrentUser, db: DbSession) -> None:
    """Unlink Google. Another strong method must remain: password with TOTP, or a passkey."""
    passkeys = db.scalar(select(func.count()).select_from(Passkey).where(Passkey.user_id == user.id)) or 0
    strong = (user.password_hash is not None and user.totp_enabled_at is not None) or passkeys > 0
    if not strong:
        raise HTTPException(status.HTTP_409_CONFLICT, "Set up another sign-in method before unlinking Google")
    user.google_sub = None
    db.commit()
