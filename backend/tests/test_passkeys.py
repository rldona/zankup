"""Passkeys (OS-405) against a software authenticator: real WebAuthn responses, signed with a P-256 key."""

import base64
import hashlib
import json
import secrets
import struct
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import cbor2
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine, func, select, update
from sqlalchemy.orm import Session, sessionmaker

from zankup.api.main import create_app
from zankup.auth import rate_limit
from zankup.auth.deps import SESSION_COOKIE
from zankup.auth.security import new_token
from zankup.core.config import Settings, get_settings
from zankup.db.models import Device, Passkey, User, WebAuthnChallenge
from zankup.db.session import get_engine, get_session

RP_ID = "zankup.test"
ORIGIN = "https://zankup.test"
SETTINGS = Settings(  # type: ignore[call-arg]
    _env_file=None,
    environment="test",
    jwt_secret=SecretStr("test-secret"),
    run_worker=False,
    webauthn_rp_id=RP_ID,
    webauthn_origins=[ORIGIN],
)

UP, UV, AT, BE, BS = 0x01, 0x04, 0x40, 0x08, 0x10


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


@dataclass
class Authenticator:
    """A platform authenticator in software: what a phone's password manager does, minus the hardware."""

    key: ec.EllipticCurvePrivateKey = field(default_factory=lambda: ec.generate_private_key(ec.SECP256R1()))
    credential_id: bytes = field(default_factory=lambda: secrets.token_bytes(32))
    sign_count: int = 0
    rp_id: str = RP_ID
    origin: str = ORIGIN

    def _cose_key(self) -> bytes:
        numbers = self.key.public_key().public_numbers()
        return cbor2.dumps(
            {1: 2, 3: -7, -1: 1, -2: numbers.x.to_bytes(32, "big"), -3: numbers.y.to_bytes(32, "big")}
        )

    def _client_data(self, kind: str, challenge: str) -> bytes:
        return json.dumps(
            {"type": kind, "challenge": challenge, "origin": self.origin, "crossOrigin": False}
        ).encode()

    def create(self, options: dict[str, Any], flags: int = UP | UV | AT | BE | BS) -> dict[str, Any]:
        rp_hash = hashlib.sha256(self.rp_id.encode()).digest()
        attested = (
            bytes(16) + struct.pack(">H", len(self.credential_id)) + self.credential_id + self._cose_key()
        )
        auth_data = rp_hash + bytes([flags]) + struct.pack(">I", self.sign_count) + attested
        attestation = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        return {
            "id": b64(self.credential_id),
            "rawId": b64(self.credential_id),
            "type": "public-key",
            "response": {
                "clientDataJSON": b64(self._client_data("webauthn.create", options["challenge"])),
                "attestationObject": b64(attestation),
                "transports": ["internal", "hybrid"],
            },
            "clientExtensionResults": {},
        }

    def get(self, options: dict[str, Any], flags: int = UP | UV | BE | BS) -> dict[str, Any]:
        self.sign_count += 1
        auth_data = (
            hashlib.sha256(self.rp_id.encode()).digest() + bytes([flags]) + struct.pack(">I", self.sign_count)
        )
        client_data = self._client_data("webauthn.get", options["challenge"])
        signature = self.key.sign(auth_data + hashlib.sha256(client_data).digest(), ec.ECDSA(hashes.SHA256()))
        return {
            "id": b64(self.credential_id),
            "rawId": b64(self.credential_id),
            "type": "public-key",
            "response": {
                "clientDataJSON": b64(client_data),
                "authenticatorData": b64(auth_data),
                "signature": b64(signature),
                "userHandle": None,
            },
            "clientExtensionResults": {},
        }


@dataclass
class Ctx:
    http: TestClient  # signed in with a browser session
    anon: TestClient  # not signed in: where passkey sign-in happens
    sessions: sessionmaker[Session]
    user_id: int


@pytest.fixture
def ctx(database: str, monkeypatch: pytest.MonkeyPatch) -> Iterator[Ctx]:
    monkeypatch.setattr(rate_limit, "limiter", rate_limit.LoginLimiter())
    monkeypatch.setattr("zankup.auth.passkeys.limiter", rate_limit.limiter)
    engine = create_engine(database)
    sessions = sessionmaker(engine, expire_on_commit=False)

    def session() -> Iterator[Session]:
        with sessions() as db:
            yield db

    token, digest = new_token()
    with sessions.begin() as db:
        user = User(email="runner@example.com")
        db.add(user)
        db.flush()
        user_id = user.id
        db.add(
            Device(
                user_id=user.id,
                name="Browser",
                platform="web",
                refresh_token_hash=digest,
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
    app = create_app(SETTINGS)
    app.dependency_overrides[get_session] = session
    app.dependency_overrides[get_settings] = lambda: SETTINGS
    app.dependency_overrides[get_engine] = lambda: engine
    http = TestClient(app)
    http.cookies.set(SESSION_COOKIE, token)
    yield Ctx(http, TestClient(app), sessions, user_id)
    engine.dispose()


def register(ctx: Ctx, authenticator: Authenticator, name: str = "Pixel") -> dict[str, Any]:
    options = ctx.http.post("/api/auth/passkeys/register/options").json()["options"]
    response = ctx.http.post(
        "/api/auth/passkeys/register",
        json={"credential": authenticator.create(options), "name": name},
    )
    assert response.status_code == 201, response.text
    return response.json()  # type: ignore[no-any-return]


def login_options(ctx: Ctx) -> dict[str, Any]:
    response = ctx.anon.post("/api/auth/passkeys/login/options")
    assert response.status_code == 200
    return response.json()["options"]  # type: ignore[no-any-return]


def test_register_then_sign_in_without_password_or_code(ctx: Ctx) -> None:
    authenticator = Authenticator()
    options = ctx.http.post("/api/auth/passkeys/register/options").json()["options"]
    assert options["rp"] == {"id": RP_ID, "name": "Zankup"}
    assert options["authenticatorSelection"]["residentKey"] == "required"
    assert options["authenticatorSelection"]["userVerification"] == "required"

    created = register(ctx, authenticator)
    assert created["name"] == "Pixel" and created["backed_up"] is True

    options = login_options(ctx)
    assert options["rpId"] == RP_ID and options["userVerification"] == "required"
    assert "allowCredentials" not in options or options["allowCredentials"] == []  # discoverable
    signed_in = ctx.anon.post("/api/auth/passkeys/login", json={"credential": authenticator.get(options)})
    assert signed_in.status_code == 200, signed_in.text
    assert signed_in.json()["email"] == "runner@example.com"
    assert ctx.anon.cookies.get(SESSION_COOKIE)
    assert ctx.anon.get("/api/auth/me").status_code == 200

    with ctx.sessions() as db:
        passkey = db.scalars(select(Passkey)).one()
        assert passkey.sign_count == 1 and passkey.last_used_at is not None


def test_the_app_gets_tokens(ctx: Ctx) -> None:
    authenticator = Authenticator()
    register(ctx, authenticator)
    response = ctx.http.post(
        "/api/auth/passkeys/login",
        json={
            "credential": authenticator.get(login_options(ctx)),
            "client": "android",
            "device_name": "Pixel",
        },
    )
    assert response.status_code == 200 and {"access_token", "refresh_token"} <= response.json().keys()


def test_a_response_cannot_be_replayed(ctx: Ctx) -> None:
    authenticator = Authenticator()
    register(ctx, authenticator)
    credential = authenticator.get(login_options(ctx))
    assert ctx.anon.post("/api/auth/passkeys/login", json={"credential": credential}).status_code == 200
    assert ctx.anon.post("/api/auth/passkeys/login", json={"credential": credential}).status_code == 401


def test_rejected_responses_all_look_the_same(ctx: Ctx) -> None:
    authenticator = Authenticator()
    register(ctx, authenticator)
    failures = []

    no_verification = authenticator.get(login_options(ctx), flags=UP)  # no fingerprint, face or PIN
    failures.append(ctx.anon.post("/api/auth/passkeys/login", json={"credential": no_verification}))

    phishing = Authenticator(
        key=authenticator.key, credential_id=authenticator.credential_id, origin="https://evil.test"
    )
    phishing.sign_count = authenticator.sign_count
    failures.append(
        ctx.anon.post("/api/auth/passkeys/login", json={"credential": phishing.get(login_options(ctx))})
    )

    stranger = Authenticator()  # never registered
    failures.append(
        ctx.anon.post("/api/auth/passkeys/login", json={"credential": stranger.get(login_options(ctx))})
    )

    forged = authenticator.get(login_options(ctx))
    forged["response"]["signature"] = b64(Authenticator().key.sign(b"x", ec.ECDSA(hashes.SHA256())))
    failures.append(ctx.anon.post("/api/auth/passkeys/login", json={"credential": forged}))

    assert [f.status_code for f in failures] == [401] * 4
    assert len({f.text for f in failures}) == 1


def test_an_expired_challenge_is_refused(ctx: Ctx) -> None:
    authenticator = Authenticator()
    register(ctx, authenticator)
    options = login_options(ctx)
    with ctx.sessions.begin() as db:
        db.execute(update(WebAuthnChallenge).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
    response = ctx.anon.post("/api/auth/passkeys/login", json={"credential": authenticator.get(options)})
    assert response.status_code == 401


def test_registering_needs_its_own_challenge_and_rejects_duplicates(ctx: Ctx) -> None:
    authenticator = Authenticator()
    register(ctx, authenticator)
    options = ctx.http.post("/api/auth/passkeys/register/options").json()["options"]
    assert [unb64(c["id"]) for c in options["excludeCredentials"]] == [authenticator.credential_id]
    again = ctx.http.post("/api/auth/passkeys/register", json={"credential": authenticator.create(options)})
    assert again.status_code == 409

    login_challenge = login_options(ctx)  # a sign-in challenge cannot register a passkey
    other = ctx.http.post(
        "/api/auth/passkeys/register",
        json={"credential": Authenticator().create(login_challenge)},
    )
    assert other.status_code == 400


def test_list_and_delete(ctx: Ctx) -> None:
    first = register(ctx, Authenticator(), "Pixel")
    register(ctx, Authenticator(), "MacBook")
    names = [p["name"] for p in ctx.http.get("/api/auth/passkeys").json()]
    assert names == ["Pixel", "MacBook"]
    assert ctx.http.delete(f"/api/auth/passkeys/{first['id']}").status_code == 204
    assert ctx.http.delete(f"/api/auth/passkeys/{first['id']}").status_code == 404
    with ctx.sessions() as db:
        assert db.scalar(select(func.count()).select_from(Passkey)) == 1


def test_someone_elses_passkey_cannot_be_deleted(ctx: Ctx) -> None:
    with ctx.sessions.begin() as db:
        other = User(email="someone@example.com")
        db.add(other)
        db.flush()
        passkey = Passkey(user_id=other.id, credential_id=b"x", public_key=b"y", name="Theirs")
        db.add(passkey)
        db.flush()
        passkey_id = passkey.id
    response = ctx.http.delete(f"/api/auth/passkeys/{passkey_id}")
    assert response.status_code == 404
