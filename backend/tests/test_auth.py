"""Authentication: every non-public route needs a session, and the sign-in flows work end to end."""

import re
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pyotp
import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine, update
from sqlalchemy.orm import Session, sessionmaker

from opensport.admin import AdminError, enable_totp, set_password
from opensport.api.main import create_app
from opensport.api.routing import PUBLIC_PATHS
from opensport.auth import rate_limit
from opensport.auth.security import AuthConfigError, decrypt_totp_secret, encrypt_totp_secret
from opensport.core.config import Settings, get_settings
from opensport.db.models import Device, User
from opensport.db.session import get_engine, get_session

PASSWORD = "correct horse battery staple"
SETTINGS = Settings(_env_file=None, environment="test", jwt_secret=SecretStr("test-secret"), run_worker=False)  # type: ignore[call-arg]


@pytest.fixture
def ctx(
    database: str, monkeypatch: pytest.MonkeyPatch
) -> Iterator[tuple[TestClient, sessionmaker[Session], str]]:
    monkeypatch.setattr(rate_limit, "limiter", rate_limit.LoginLimiter())
    monkeypatch.setattr("opensport.auth.routes.limiter", rate_limit.limiter)
    engine = create_engine(database)
    sessions = sessionmaker(engine, expire_on_commit=False)

    def session() -> Iterator[Session]:
        with sessions() as db:
            yield db

    app = create_app(SETTINGS)
    app.dependency_overrides[get_session] = session
    app.dependency_overrides[get_settings] = lambda: SETTINGS
    app.dependency_overrides[get_engine] = lambda: engine
    secret = pyotp.random_base32()
    with sessions.begin() as db:
        user = User(email="runner@example.com")
        db.add(user)
        db.flush()
        set_password(db, user, PASSWORD)
        enable_totp(user, secret, pyotp.TOTP(secret).now(), "test-secret")
    yield TestClient(app), sessions, secret
    engine.dispose()


def next_code(secret: str, steps: int = 1) -> str:
    """A code for a later time step (the current one was used to enable TOTP)."""
    return pyotp.TOTP(secret).at(datetime.now(UTC) + timedelta(seconds=30 * steps))


def sign_in(http: TestClient, secret: str, steps: int = 1, **extra: object) -> dict:  # type: ignore[type-arg]
    """Password then code; `extra` goes into the login body (remember, client, device_name)."""
    challenge = http.post(
        "/api/auth/login", json={"email": "runner@example.com", "password": PASSWORD, **extra}
    )
    assert challenge.status_code == 200, challenge.text
    response = http.post(
        "/api/auth/login/totp",
        json={"challenge": challenge.json()["challenge"], "code": next_code(secret, steps)},
    )
    assert response.status_code == 200, response.text
    return response.json()  # type: ignore[no-any-return]


def test_every_route_but_health_and_sign_in_needs_a_session(
    ctx: tuple[TestClient, sessionmaker[Session], str],
) -> None:
    client = ctx[0]
    routes = [r for r in client.app.routes if isinstance(r, APIRoute)]  # type: ignore[attr-defined]
    assert routes
    for route in routes:
        if route.path in PUBLIC_PATHS:
            continue
        path = re.sub(r"\{[^}]+\}", "1", route.path)
        for method in route.methods:
            response = client.request(method, path)
            assert response.status_code == 401, (
                f"{method} {route.path} answered {response.status_code} without a session"
            )


def test_browser_session_flow(ctx: tuple[TestClient, sessionmaker[Session], str]) -> None:
    client, _, secret = ctx
    me = sign_in(client, secret)
    assert me["email"] == "runner@example.com" and me["totp_enabled"] is True
    assert client.cookies.get("opensport_session")
    assert client.get("/api/auth/me").status_code == 200
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_errors_never_say_what_was_wrong(ctx: tuple[TestClient, sessionmaker[Session], str]) -> None:
    client = ctx[0]
    wrong_password = client.post("/api/auth/login", json={"email": "runner@example.com", "password": "nope"})
    unknown_email = client.post("/api/auth/login", json={"email": "who@example.com", "password": PASSWORD})
    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json() == unknown_email.json()

    challenge = client.post(
        "/api/auth/login", json={"email": "runner@example.com", "password": PASSWORD}
    ).json()
    wrong_code = client.post(
        "/api/auth/login/totp", json={"challenge": challenge["challenge"], "code": "000000"}
    )
    assert wrong_code.status_code == 401 and wrong_code.json() == wrong_password.json()


def test_a_code_cannot_be_used_twice(ctx: tuple[TestClient, sessionmaker[Session], str]) -> None:
    client, _, secret = ctx
    sign_in(client, secret, steps=1)
    challenge = client.post(
        "/api/auth/login", json={"email": "runner@example.com", "password": PASSWORD}
    ).json()
    replay = client.post(
        "/api/auth/login/totp", json={"challenge": challenge["challenge"], "code": next_code(secret, 1)}
    )
    assert replay.status_code == 401


def test_repeated_failures_are_slowed_down(ctx: tuple[TestClient, sessionmaker[Session], str]) -> None:
    client = ctx[0]
    statuses = [
        client.post(
            "/api/auth/login", json={"email": "runner@example.com", "password": f"wrong {n}"}
        ).status_code
        for n in range(7)
    ]
    assert statuses[:5] == [401] * 5 and statuses[6] == 429
    blocked = client.post("/api/auth/login", json={"email": "runner@example.com", "password": PASSWORD})
    assert (
        blocked.status_code == 429 and int(blocked.headers["Retry-After"]) > 0
    )  # even the right password waits


def test_app_tokens_refresh_and_revocation(ctx: tuple[TestClient, sessionmaker[Session], str]) -> None:
    client, sessions, secret = ctx
    tokens = sign_in(client, secret, client="android", device_name="Pixel")
    client.cookies.clear()
    bearer = {"Authorization": f"Bearer {tokens['access_token']}"}
    assert client.get("/api/auth/me", headers=bearer).status_code == 200

    rotated = client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert rotated.status_code == 200 and rotated.json()["refresh_token"] != tokens["refresh_token"]
    assert (
        client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code == 401
    )

    with sessions.begin() as db:  # revoke the device: its access token stops working at once
        db.execute(update(Device).values(expires_at=None))
        for device in db.query(Device).all():
            db.delete(device)
    assert client.get("/api/auth/me", headers=bearer).status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer forged"}).status_code == 401


def test_expired_browser_sessions_are_rejected(ctx: tuple[TestClient, sessionmaker[Session], str]) -> None:
    client, sessions, secret = ctx
    sign_in(client, secret)
    with sessions.begin() as db:
        db.execute(update(Device).values(expires_at=datetime.now(UTC) - timedelta(minutes=1)))
    assert client.get("/api/auth/me").status_code == 401


def test_two_factor_is_required(ctx: tuple[TestClient, sessionmaker[Session], str]) -> None:
    client, sessions, _ = ctx
    with sessions.begin() as db:
        db.execute(update(User).values(totp_enabled_at=None, totp_secret_enc=None))
    response = client.post("/api/auth/login", json={"email": "runner@example.com", "password": PASSWORD})
    assert response.status_code == 403


def test_admin_rules() -> None:
    user = User(email="x@example.com")
    with pytest.raises(AdminError):
        set_password(None, user, "short")  # type: ignore[arg-type]
    with pytest.raises(AdminError):
        enable_totp(user, pyotp.random_base32(), "123456", "secret")


def test_totp_secrets_are_encrypted_with_jwt_secret() -> None:
    encrypted = encrypt_totp_secret("JBSWY3DPEHPK3PXP", "one")
    assert "JBSWY3DPEHPK3PXP" not in encrypted and decrypt_totp_secret(encrypted, "one") == "JBSWY3DPEHPK3PXP"
    with pytest.raises(AuthConfigError):
        decrypt_totp_secret(encrypted, "another")
    with pytest.raises(AuthConfigError):
        encrypt_totp_secret("JBSWY3DPEHPK3PXP", None)
