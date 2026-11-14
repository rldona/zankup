"""OAuth for the MCP server, so an AI assistant can be connected from its own app (Claude: Settings →
Connectors → add a custom connector with Zankup's MCP address), as the MCP authorisation spec asks:

1. The MCP endpoint answers 401 with where its metadata is; the metadata names this server.
2. The assistant registers itself (dynamic client registration): a public client, PKCE, no secret.
3. It sends the person to the app's /oauth/authorize page: signed in there, they allow or deny it,
   and the page asks /api/oauth/approve for a code to send back.
4. The assistant trades the code (and its PKCE verifier) for a token: a personal MCP token with the
   assistant's name, listed in Settings, where it can be revoked like any other.

The tokens do not expire; read-only, they can do no more than the personal ones.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from zankup.auth.deps import AppSettings, CurrentUser, DbSession
from zankup.auth.security import token_hash
from zankup.core.config import Settings
from zankup.db.models import ApiToken, OAuthClient, OAuthCode

router = APIRouter(tags=["oauth"])

CODE_LIFETIME = timedelta(minutes=10)
SCOPE = "mcp"
TOKEN_PREFIX = "zk_"  # as the personal tokens (api/ai.py): the MCP server takes both alike


def app_origin(settings: Settings) -> str:
    """The app's address, where the person signs in and authorises (as e-mail links do)."""
    return (settings.webauthn_origins[0] if settings.webauthn_origins else "http://localhost:5173").rstrip(
        "/"
    )


def api_origin(settings: Settings) -> str:
    """The API's own address, where the assistant reaches the MCP server and this one."""
    return (settings.api_public_url or app_origin(settings)).rstrip("/")


def resource_metadata_url(settings: Settings) -> str:
    return f"{api_origin(settings)}/.well-known/oauth-protected-resource/api/mcp"


# --- discovery -------------------------------------------------------------------------------------


@router.get("/.well-known/oauth-protected-resource", include_in_schema=False)
@router.get("/.well-known/oauth-protected-resource/api/mcp", include_in_schema=False)
def protected_resource(settings: AppSettings) -> dict[str, Any]:
    """RFC 9728: the MCP server and the server that authorises it."""
    base = api_origin(settings)
    return {
        "resource": f"{base}/api/mcp",
        "authorization_servers": [base],
        "bearer_methods_supported": ["header"],
        "scopes_supported": [SCOPE],
        "resource_name": "Zankup",
    }


@router.get("/.well-known/oauth-authorization-server", include_in_schema=False)
@router.get("/.well-known/openid-configuration", include_in_schema=False)
def authorization_server(settings: AppSettings) -> dict[str, Any]:
    """RFC 8414: where to register, authorise (the app's page) and get a token."""
    base = api_origin(settings)
    return {
        "issuer": base,
        "authorization_endpoint": f"{app_origin(settings)}/oauth/authorize",
        "token_endpoint": f"{base}/api/oauth/token",
        "registration_endpoint": f"{base}/api/oauth/register",
        "scopes_supported": [SCOPE],
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
    }


# --- registration ----------------------------------------------------------------------------------


class Registration(BaseModel):
    client_name: str | None = Field(default=None, max_length=120)
    redirect_uris: list[str] = Field(min_length=1, max_length=10)


def _redirect_allowed(uri: str) -> bool:
    """HTTPS, or HTTP on this computer (desktop assistants listen on localhost)."""
    url = urlparse(uri)
    if url.fragment or not url.netloc:
        return False
    return url.scheme == "https" or (url.scheme == "http" and url.hostname in ("localhost", "127.0.0.1"))


@router.post("/api/oauth/register", status_code=status.HTTP_201_CREATED, include_in_schema=False)
def register(body: Registration, db: DbSession) -> dict[str, Any]:
    """RFC 7591: an assistant registers itself. Open, as the spec expects: a client can do nothing
    until the person authorises it."""
    if not all(_redirect_allowed(u) for u in body.redirect_uris):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, {"error": "invalid_redirect_uri"})
    client = OAuthClient(
        id=secrets.token_urlsafe(24),
        name=(body.client_name or "AI assistant").strip()[:120] or "AI assistant",
        redirect_uris=body.redirect_uris,
    )
    db.add(client)
    db.commit()
    return {
        "client_id": client.id,
        "client_name": client.name,
        "redirect_uris": client.redirect_uris,
        "token_endpoint_auth_method": "none",
        "grant_types": ["authorization_code"],
        "response_types": ["code"],
        "client_id_issued_at": int(datetime.now(UTC).timestamp()),
    }


# --- authorisation (the app's page) ----------------------------------------------------------------


def _client(db: DbSession, client_id: str, redirect_uri: str) -> OAuthClient:
    client = db.get(OAuthClient, client_id)
    if client is None or redirect_uri not in client.redirect_uris:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown assistant or address")
    return client


class ClientOut(BaseModel):
    name: str


@router.get("/api/oauth/client", operation_id="getOAuthClient")
def client_info(client_id: str, redirect_uri: str, db: DbSession, user: CurrentUser) -> ClientOut:
    """The assistant asking, for the page: only when the address it sends the answer to is its own."""
    return ClientOut(name=_client(db, client_id, redirect_uri).name)


class Approval(BaseModel):
    client_id: str
    redirect_uri: str
    code_challenge: str = Field(min_length=43, max_length=128)
    code_challenge_method: str = "S256"
    state: str | None = Field(default=None, max_length=2000)


class Redirect(BaseModel):
    redirect: str = Field(description="Where to send the browser: the assistant, with the code")


@router.post("/api/oauth/approve", operation_id="approveOAuth")
def approve(body: Approval, db: DbSession, user: CurrentUser) -> Redirect:
    """The person allows the assistant: a code for it, for ten minutes and one use."""
    if body.code_challenge_method != "S256":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only S256")
    client = _client(db, body.client_id, body.redirect_uri)
    code = secrets.token_urlsafe(32)
    db.add(
        OAuthCode(
            code_hash=token_hash(code),
            client_id=client.id,
            user_id=user.id,
            redirect_uri=body.redirect_uri,
            code_challenge=body.code_challenge,
            expires_at=datetime.now(UTC) + CODE_LIFETIME,
        )
    )
    db.commit()
    query = {"code": code, **({"state": body.state} if body.state else {})}
    sep = "&" if "?" in body.redirect_uri else "?"
    return Redirect(redirect=f"{body.redirect_uri}{sep}{urlencode(query)}")


# --- token -----------------------------------------------------------------------------------------


def _oauth_error(error: str, description: str) -> JSONResponse:
    return JSONResponse(
        {"error": error, "error_description": description},
        status_code=400,
        headers={"Cache-Control": "no-store"},
    )


def challenge_of(verifier: str) -> str:
    """S256: base64url of the verifier's SHA-256, without padding."""
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


@router.post("/api/oauth/token", include_in_schema=False)
async def token(request: Request, db: DbSession) -> JSONResponse:
    """The code and its PKCE verifier for a token: a personal MCP token named after the assistant.
    The form is read here (application/x-www-form-urlencoded), without a multipart dependency."""
    form = {k: v[0] for k, v in parse_qs((await request.body()).decode()).items()}
    grant_type = form.get("grant_type", "")
    code = form.get("code", "")
    redirect_uri = form.get("redirect_uri", "")
    client_id = form.get("client_id", "")
    code_verifier = form.get("code_verifier", "")
    if grant_type != "authorization_code":
        return _oauth_error("unsupported_grant_type", "Only authorization_code")
    row = db.get(OAuthCode, token_hash(code))
    now = datetime.now(UTC)
    if (
        row is None
        or row.used_at is not None
        or row.expires_at < now
        or row.client_id != client_id
        or row.redirect_uri != redirect_uri
    ):
        return _oauth_error("invalid_grant", "The code is unknown, used or expired")
    if not secrets.compare_digest(challenge_of(code_verifier), row.code_challenge):
        return _oauth_error("invalid_grant", "The code verifier does not match")
    row.used_at = now
    client = db.get_one(OAuthClient, client_id)
    secret = TOKEN_PREFIX + secrets.token_urlsafe(32)
    db.add(ApiToken(user_id=row.user_id, name=client.name, token_hash=token_hash(secret), prefix=secret[:8]))
    db.commit()
    return JSONResponse(
        {"access_token": secret, "token_type": "Bearer", "scope": SCOPE},
        headers={"Cache-Control": "no-store"},
    )


def www_authenticate(settings: Settings) -> str:
    """The MCP server's 401: where its metadata is, so an assistant can find how to authorise."""
    return f'Bearer resource_metadata="{resource_metadata_url(settings)}"'
