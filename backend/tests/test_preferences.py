"""Preferences (OS-214): the theme follows the user across browsers and the app."""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from zankup.api.main import create_app
from zankup.auth.deps import SESSION_COOKIE
from zankup.auth.security import new_token
from zankup.core.config import Settings, get_settings
from zankup.db.models import Device, User, UserSettings
from zankup.db.session import get_engine, get_session

SETTINGS = Settings(_env_file=None, environment="test", jwt_secret=SecretStr("test-secret"), run_worker=False)  # type: ignore[call-arg]


@pytest.fixture
def http(database: str) -> Iterator[tuple[TestClient, sessionmaker[Session], int]]:
    engine = create_engine(database)
    sessions = sessionmaker(engine, expire_on_commit=False)

    def session() -> Iterator[Session]:
        with sessions() as db:
            yield db

    token, digest = new_token()
    with sessions.begin() as db:
        user = User(email="runner@example.com")  # no settings row yet, like accounts from before OS-214
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
    client = TestClient(app)
    client.cookies.set(SESSION_COOKIE, token)
    yield client, sessions, user_id
    engine.dispose()


def test_the_theme_starts_as_system_and_is_kept(http: tuple[TestClient, sessionmaker[Session], int]) -> None:
    client, sessions, user_id = http
    assert client.get("/api/settings").json() == {"theme": "system"}
    assert client.patch("/api/settings", json={"theme": "oled"}).json() == {"theme": "oled"}
    assert client.patch("/api/settings", json={}).json() == {"theme": "oled"}  # nothing sent, nothing changed
    assert client.get("/api/settings").json() == {"theme": "oled"}
    with sessions() as db:
        assert db.get_one(UserSettings, user_id).theme == "oled"


def test_unknown_themes_are_refused(http: tuple[TestClient, sessionmaker[Session], int]) -> None:
    client, _, _ = http
    assert client.patch("/api/settings", json={"theme": "neon"}).status_code == 422


def test_settings_need_a_session(http: tuple[TestClient, sessionmaker[Session], int]) -> None:
    client, _, _ = http
    client.cookies.clear()
    assert client.get("/api/settings").status_code == 401
