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
from zankup.db.models import Activity, Device, User, UserSettings
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
    defaults = {
        "theme": "system",
        "language": None,
        "units": "metric",
        "hr_max": None,
        "hr_rest": None,
        "hr_max_estimate": None,
        "zone_model": "max",
        "lthr": None,
        "ftp": None,
        "privacy_zones": [],
        "notifications": {
            "activity": True,
            "record": True,
            "sync_error": True,
            "garmin_key": True,
            "estimate": False,
            "import": True,
        },
    }
    assert client.get("/api/settings").json() == defaults
    assert client.patch("/api/settings", json={"theme": "oled"}).json()["theme"] == "oled"
    assert client.patch("/api/settings", json={}).json() == defaults | {"theme": "oled"}  # nothing sent
    assert client.get("/api/settings").json()["theme"] == "oled"
    with sessions() as db:
        assert db.get_one(UserSettings, user_id).theme == "oled"


def test_unknown_themes_are_refused(http: tuple[TestClient, sessionmaker[Session], int]) -> None:
    client, _, _ = http
    assert client.patch("/api/settings", json={"theme": "neon"}).status_code == 422


def test_settings_need_a_session(http: tuple[TestClient, sessionmaker[Session], int]) -> None:
    client, _, _ = http
    client.cookies.clear()
    assert client.get("/api/settings").status_code == 401


def test_language_units_and_heart_rate(http: tuple[TestClient, sessionmaker[Session], int]) -> None:
    client, sessions, user_id = http
    with sessions.begin() as db:
        for external_id, max_hr in (("1", 181), ("2", 187)):
            db.add(
                Activity(
                    user_id=user_id,
                    source="garmin",
                    external_id=external_id,
                    sport="run",
                    start_utc=datetime.now(UTC),
                    duration_s=60,
                    max_hr=max_hr,
                )
            )
    assert client.get("/api/settings").json()["hr_max_estimate"] == 187
    changed = client.patch(
        "/api/settings", json={"language": "es", "units": "imperial", "hr_max": 190, "hr_rest": 48}
    ).json()
    assert (changed["language"], changed["units"], changed["hr_max"], changed["hr_rest"]) == (
        "es",
        "imperial",
        190,
        48,
    )
    assert client.patch("/api/settings", json={"hr_max": None}).json()["hr_max"] is None  # cleared
    assert client.patch("/api/settings", json={"hr_max": 300}).status_code == 422
    assert client.patch("/api/settings", json={"language": "fr"}).status_code == 422
