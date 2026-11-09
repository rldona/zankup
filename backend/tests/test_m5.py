"""Milestone 5 on the backend: the app's native Google sign-in (OS-503) and FCM notifications (OS-507)."""

from __future__ import annotations

import json
import time
from typing import Any

import pytest
from pydantic import SecretStr
from sqlalchemy import select

from tests.test_activities import SETTINGS, Ctx, ctx  # noqa: F401
from zankup.core.config import get_settings
from zankup.db.models import Activity, Device, User
from zankup.notify import deliver, notify


def owner(context: Ctx) -> int:
    with context.sessions() as db:
        return db.get_one(Activity, context.ids["run"]).user_id


@pytest.fixture
def google(ctx: Ctx, monkeypatch: pytest.MonkeyPatch) -> Ctx:  # noqa: F811
    settings = SETTINGS.model_copy(
        update={"google_client_id": "web-client", "google_client_secret": SecretStr("s")}
    )
    app: Any = ctx.http.app
    app.dependency_overrides[get_settings] = lambda: settings

    def verify(token: str, client_id: str, nonce: str | None, http: object = None) -> dict[str, Any]:
        assert client_id == "web-client"
        if nonce is not None and token != f"good:{nonce}":
            raise ValueError("Invalid ID token: nonce")
        issued = 0 if token.startswith("old") else time.time()
        return {"sub": "google-123", "email_verified": True, "iat": issued}

    monkeypatch.setattr("zankup.auth.google.verify_id_token", verify)
    return ctx


def test_native_google_signs_in_only_the_linked_account(google: Ctx) -> None:
    started = google.http.get("/api/auth/google/mobile/nonce").json()
    body = {"id_token": f"good:{started['nonce']}", "state": started["state"], "device_name": "Pixel"}
    assert google.http.post("/api/auth/google/mobile", json=body).status_code == 401  # not linked yet
    with google.sessions.begin() as db:
        db.get_one(User, owner(google)).google_sub = "google-123"
    tokens = google.http.post("/api/auth/google/mobile", json=body).json()
    assert tokens["access_token"] and tokens["refresh_token"]
    with google.sessions() as db:
        device = db.scalar(select(Device).where(Device.name == "Pixel"))
        assert device is not None and device.platform == "android"
    google.http.cookies.clear()
    me = google.http.get("/api/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert me.status_code == 200 and me.json()["email"] == "runner@example.com"
    wrong = {**body, "id_token": "good:another-nonce"}
    assert google.http.post("/api/auth/google/mobile", json=wrong).status_code == 401
    forged = {**body, "state": "x.y.z"}
    assert google.http.post("/api/auth/google/mobile", json=forged).status_code == 401


def test_without_a_nonce_the_token_must_be_fresh_and_used_once(google: Ctx) -> None:
    with google.sessions.begin() as db:
        db.get_one(User, owner(google)).google_sub = "google-123"
    assert google.http.post("/api/auth/google/mobile", json={"id_token": "fresh-1"}).status_code == 200
    assert google.http.post("/api/auth/google/mobile", json={"id_token": "fresh-1"}).status_code == 401
    assert google.http.post("/api/auth/google/mobile", json={"id_token": "old-1"}).status_code == 401


def test_native_google_is_hidden_when_not_configured(ctx: Ctx) -> None:  # noqa: F811
    assert ctx.http.get("/api/auth/google/mobile/nonce").status_code == 404


ACCOUNT = {"client_email": "fcm@example.iam.gserviceaccount.com", "private_key": "k", "project_id": "zankup"}


def test_the_app_receives_notifications_through_fcm(ctx: Ctx, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    assert ctx.http.put("/api/notifications/fcm", json={"token": "fcm-token-1"}).status_code == 204
    user_id = owner(ctx)
    with ctx.sessions.begin() as db:
        assert notify(
            db, user_id, "record", {"activity_id": 1, "distance_key": "5k", "time_s": 1500}, key="r"
        )
    sent: list[dict[str, Any]] = []

    class Answer:
        status_code = 200

    def post(url: str, **kwargs: Any) -> Answer:
        sent.append({"url": url, **kwargs})
        return Answer()

    monkeypatch.setattr("zankup.notify.fcm_access_token", lambda account: "oauth-token")
    monkeypatch.setattr("zankup.notify.httpx.post", post)
    settings = SETTINGS.model_copy(update={"fcm_service_account": SecretStr(json.dumps(ACCOUNT))})
    content = {"title": "New record", "body": "5 km in 25:00", "url": "/activities/1", "tag": "record"}
    with ctx.sessions.begin() as db:
        assert deliver(db, settings, user_id, content) == 1
    assert sent[0]["url"] == "https://fcm.googleapis.com/v1/projects/zankup/messages:send"
    message = sent[0]["json"]["message"]
    assert message["token"] == "fcm-token-1" and message["data"]["url"] == "/activities/1"
    assert sent[0]["headers"]["Authorization"] == "Bearer oauth-token"
    Answer.status_code = 404  # FCM forgot the token: so do we
    with ctx.sessions.begin() as db:
        assert deliver(db, settings, user_id, content) == 0
    with ctx.sessions() as db:
        assert db.scalars(select(Device.push_endpoint)).all() == [None]
    assert ctx.http.put("/api/notifications/fcm", json={"token": None}).status_code == 204


def test_the_fcm_access_token_is_a_signed_jwt_grant(monkeypatch: pytest.MonkeyPatch) -> None:
    import jwt
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    from zankup import notify as module

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    seen: list[str] = []

    class Answer:
        def raise_for_status(self) -> None: ...

        def json(self) -> dict[str, Any]:
            return {"access_token": "ya29.token", "expires_in": 3600}

    def post(url: str, data: dict[str, str], timeout: float) -> Answer:
        seen.append(data["assertion"])
        return Answer()

    monkeypatch.setattr(module, "_fcm_token", {})
    monkeypatch.setattr("zankup.notify.httpx.post", post)
    account = {**ACCOUNT, "private_key": pem}
    assert module.fcm_access_token(account) == "ya29.token"
    assert module.fcm_access_token(account) == "ya29.token" and len(seen) == 1  # cached
    claims = jwt.decode(
        seen[0], key.public_key(), algorithms=["RS256"], audience="https://oauth2.googleapis.com/token"
    )
    assert claims["scope"] == module.FCM_SCOPE and claims["iss"] == ACCOUNT["client_email"]


def test_the_app_can_keep_its_refresh_token(google: Ctx) -> None:
    with google.sessions.begin() as db:
        db.get_one(User, owner(google)).google_sub = "google-123"
    tokens = google.http.post("/api/auth/google/mobile", json={"id_token": "fresh-2"}).json()
    same = google.http.post(
        "/api/auth/refresh", json={"refresh_token": tokens["refresh_token"], "rotate": False}
    )
    assert same.status_code == 200 and same.json()["refresh_token"] == tokens["refresh_token"]
    rotated = google.http.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).json()
    assert rotated["refresh_token"] != tokens["refresh_token"]
    old = google.http.post(
        "/api/auth/refresh", json={"refresh_token": tokens["refresh_token"], "rotate": False}
    )
    assert old.status_code == 401
