"""Sign-in with Google (OS-220) against a fake Google: real RS256 ID tokens, PKCE, state and nonce."""

import base64
import hashlib
import json
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
import jwt
import pytest
import respx
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from zankup.api.main import create_app
from zankup.auth.deps import SESSION_COOKIE
from zankup.auth.google import CERTS_URL, COOKIE, TOKEN_URL
from zankup.auth.security import new_token
from zankup.core.config import Settings, get_settings
from zankup.db.models import Device, Passkey, User
from zankup.db.session import get_engine, get_session

CLIENT_ID = "client.apps.googleusercontent.com"
ORIGIN = "https://zankup.test"
SETTINGS = Settings(  # type: ignore[call-arg]
    _env_file=None,
    environment="test",
    jwt_secret=SecretStr("test-secret"),
    run_worker=False,
    google_client_id=CLIENT_ID,
    google_client_secret=SecretStr("shh"),
    webauthn_origins=[ORIGIN],
)
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
JWK = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(KEY.public_key())) | {
    "kid": "k1",
    "alg": "RS256",
    "use": "sig",
}


@dataclass
class Ctx:
    signed_in: TestClient
    anon: TestClient
    google: respx.Router
    user_id: int
    claims: dict[str, Any]


@pytest.fixture
def ctx(database: str) -> Iterator[Ctx]:
    engine = create_engine(database)
    sessions = sessionmaker(engine, expire_on_commit=False)

    def session() -> Iterator[Session]:
        with sessions() as db:
            yield db

    token, digest = new_token()
    with sessions.begin() as db:
        user = User(email="me@example.com", password_hash="x", totp_enabled_at=datetime.now(UTC))
        db.add(user)
        db.flush()
        db.add(
            Device(
                user_id=user.id,
                name="Browser",
                platform="web",
                refresh_token_hash=digest,
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
        user_id = user.id
    app = create_app(SETTINGS)
    app.dependency_overrides[get_session] = session
    app.dependency_overrides[get_settings] = lambda: SETTINGS
    app.dependency_overrides[get_engine] = lambda: engine
    signed_in = TestClient(app, base_url=ORIGIN, follow_redirects=False)
    signed_in.cookies.set(SESSION_COOKIE, token)
    anon = TestClient(app, base_url=ORIGIN, follow_redirects=False)
    claims: dict[str, Any] = {"sub": "google-123", "email": "me@gmail.com", "email_verified": True}
    with respx.mock(assert_all_called=False) as google:
        google.get(CERTS_URL).mock(return_value=httpx.Response(200, json={"keys": [JWK]}))
        yield Ctx(signed_in, anon, google, user_id, claims)
    engine.dispose()


def go_through_google(ctx: Ctx, client: TestClient, mode: str = "login", **overrides: Any) -> httpx.Response:
    """Start, let the fake Google sign the ID token for that flow's nonce, and come back."""
    start = client.get("/api/auth/google/start", params={"mode": mode, "next": "/activities/7"})
    assert start.status_code == 303, start.text
    query = parse_qs(urlparse(start.headers["location"]).query)
    assert query["scope"] == ["openid email profile"] and query["code_challenge_method"] == ["S256"]
    challenge, nonce = query["code_challenge"][0], overrides.pop("nonce", query["nonce"][0])
    state = overrides.pop("state", query["state"][0])
    now = datetime.now(UTC)
    id_token = jwt.encode(
        {
            "iss": "https://accounts.google.com",
            "aud": CLIENT_ID,
            "iat": now,
            "exp": now + timedelta(minutes=5),
            "nonce": nonce,
            **ctx.claims,
            **overrides,
        },
        KEY,
        algorithm="RS256",
        headers={"kid": "k1"},
    )

    def token(request: httpx.Request) -> httpx.Response:
        form = parse_qs(request.content.decode())
        verifier = form["code_verifier"][0]
        digest = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        assert digest == challenge  # PKCE
        assert form["redirect_uri"] == [f"{ORIGIN}/api/auth/google/callback"]
        return httpx.Response(200, json={"id_token": id_token, "access_token": "a"})

    ctx.google.post(TOKEN_URL).mock(side_effect=token)
    return client.get("/api/auth/google/callback", params={"code": "c", "state": state})


def test_link_then_sign_in_without_a_code(ctx: Ctx) -> None:
    linked = go_through_google(ctx, ctx.signed_in, "link")
    assert linked.headers["location"] == f"{ORIGIN}/profile?tab=account&google=linked"
    assert ctx.signed_in.get("/api/auth/me").json()["google_linked"] is True

    signed = go_through_google(ctx, ctx.anon)
    assert signed.headers["location"] == f"{ORIGIN}/activities/7"
    assert signed.cookies.get(SESSION_COOKIE) or ctx.anon.cookies.get(SESSION_COOKIE)
    assert ctx.anon.get("/api/auth/me").json()["email"] == "me@example.com"


def test_any_other_google_account_is_turned_away(ctx: Ctx) -> None:
    go_through_google(ctx, ctx.signed_in, "link")
    ctx.claims["sub"] = "someone-else"
    rejected = go_through_google(ctx, ctx.anon)
    assert rejected.headers["location"] == f"{ORIGIN}/sign-in?error=google"
    assert ctx.anon.get("/api/auth/me").status_code == 401


@pytest.mark.parametrize(
    "tamper",
    [
        {"state": "forged"},
        {"nonce": "replayed"},
        {"email_verified": False},
        {"aud": "another-client"},
        {"iss": "https://evil.test"},
    ],
)
def test_forged_or_unverified_answers_fail(ctx: Ctx, tamper: dict[str, Any]) -> None:
    go_through_google(ctx, ctx.signed_in, "link")
    rejected = go_through_google(ctx, ctx.anon, **tamper)
    assert rejected.headers["location"] == f"{ORIGIN}/sign-in?error=google"
    assert ctx.anon.get("/api/auth/me").status_code == 401


def test_linking_needs_a_session_and_unlinking_another_method(ctx: Ctx, database: str) -> None:
    assert ctx.anon.get("/api/auth/google/start", params={"mode": "link"}).status_code == 401
    go_through_google(ctx, ctx.signed_in, "link")
    engine = create_engine(database)
    with Session(engine) as db, db.begin():
        user = db.get_one(User, ctx.user_id)
        user.totp_enabled_at = None  # no password with 2FA, no passkey: Google is the only way in
    assert ctx.signed_in.delete("/api/auth/google").status_code == 409
    with Session(engine) as db, db.begin():
        db.add(Passkey(user_id=ctx.user_id, credential_id=b"c", public_key=b"k", name="Pixel"))
    assert ctx.signed_in.delete("/api/auth/google").status_code == 204
    assert ctx.signed_in.get("/api/auth/me").json()["google_linked"] is False
    engine.dispose()


def test_providers_and_safe_redirects(ctx: Ctx) -> None:
    assert ctx.anon.get("/api/auth/google/providers").json() == {
        "google": True,
        "google_client_id": CLIENT_ID,
    }
    start = ctx.anon.get("/api/auth/google/start", params={"next": "https://evil.test"})
    flow = jwt.decode(start.cookies[COOKIE], options={"verify_signature": False})
    assert flow["next"] == "/"


def test_google_brings_the_photo_and_a_missing_name(ctx: Ctx, database: str) -> None:
    ctx.claims.update({"picture": "https://lh3.googleusercontent.com/a/photo", "name": "Ana López García"})
    engine = create_engine(database)
    try:
        with Session(engine) as db:
            user = db.get(User, ctx.user_id)
            assert user is not None
            user.display_name = None
            db.commit()
    finally:
        engine.dispose()  # or the pooled connection is left open (ResourceWarning under -W error)
    go_through_google(ctx, ctx.signed_in, "link")
    me = ctx.signed_in.get("/api/auth/me").json()
    assert me["avatar_url"] == "https://lh3.googleusercontent.com/a/photo"
    assert me["display_name"] == "Ana López García"

    # Later sign-ins keep the photo fresh but never replace a name the person chose.
    ctx.signed_in.patch("/api/auth/me", json={"display_name": "Ana"})
    ctx.claims["picture"] = "https://lh3.googleusercontent.com/a/new"
    go_through_google(ctx, ctx.anon)
    me = ctx.anon.get("/api/auth/me").json()
    assert me["avatar_url"] == "https://lh3.googleusercontent.com/a/new" and me["display_name"] == "Ana"
