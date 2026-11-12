"""Development sign-in: one click as the first user, only with DEV_LOGIN and never in production."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError
from sqlalchemy import Engine, create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from zankup.api.main import create_app
from zankup.core.config import Settings, get_settings
from zankup.db.models import Device, User
from zankup.db.session import get_engine, get_session

BASE = {"_env_file": None, "environment": "test", "jwt_secret": SecretStr("test-secret"), "run_worker": False}
DEV = Settings(**BASE, dev_login=True)  # type: ignore[arg-type]
OFF = Settings(**BASE, dev_login=False)  # type: ignore[arg-type]


class Client:
    """A test client for the given settings, on the throwaway database."""

    def __init__(self, engine: Engine, sessions: sessionmaker[Session]) -> None:
        self.engine = engine
        self.sessions = sessions

    def __call__(self, settings: Settings) -> TestClient:
        def session() -> Iterator[Session]:
            with self.sessions() as db:
                yield db

        app = create_app(settings)
        app.dependency_overrides[get_session] = session
        app.dependency_overrides[get_settings] = lambda: settings
        app.dependency_overrides[get_engine] = lambda: self.engine
        return TestClient(app)


@pytest.fixture
def client(database: str) -> Iterator[tuple[sessionmaker[Session], Client]]:
    engine = create_engine(database)
    sessions = sessionmaker(engine, expire_on_commit=False)
    yield sessions, Client(engine, sessions)
    engine.dispose()


def add_users(sessions: sessionmaker[Session]) -> None:
    with sessions.begin() as db:
        db.add(User(email="owner@example.com"))
        db.flush()
        db.add(User(email="second@example.com"))


def count(sessions: sessionmaker[Session], model: type[User] | type[Device]) -> int:
    with sessions() as db:
        return db.scalar(select(func.count()).select_from(model)) or 0


def test_signs_in_as_the_first_user(client: tuple[sessionmaker[Session], Client]) -> None:
    sessions, make = client
    add_users(sessions)
    http = make(DEV)
    response = http.post("/api/auth/dev-login")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["email"] == "owner@example.com"
    assert "access_token" not in body and "refresh_token" not in body
    assert "zankup_session" in response.cookies
    me = http.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "owner@example.com"
    with sessions() as db:
        device = db.scalars(select(Device)).one()
        assert (device.platform, device.name) == ("web", "Dev")
    assert count(sessions, User) == 2


def test_not_found_when_off(client: tuple[sessionmaker[Session], Client]) -> None:
    sessions, make = client
    add_users(sessions)
    response = make(OFF).post("/api/auth/dev-login")
    assert response.status_code == 404
    assert "zankup_session" not in response.cookies
    assert count(sessions, Device) == 0


def test_conflict_without_an_account(client: tuple[sessionmaker[Session], Client]) -> None:
    sessions, make = client
    response = make(DEV).post("/api/auth/dev-login")
    assert response.status_code == 409
    assert count(sessions, User) == 0
    assert count(sessions, Device) == 0


def test_providers_say_whether_it_is_on(client: tuple[sessionmaker[Session], Client]) -> None:
    _, make = client
    assert make(DEV).get("/api/auth/google/providers").json()["dev_login"] is True
    assert make(OFF).get("/api/auth/google/providers").json()["dev_login"] is False
    production = Settings(**{**BASE, "environment": "production"})  # type: ignore[arg-type]
    assert make(production).get("/api/auth/google/providers").json()["dev_login"] is False


def test_refused_in_production() -> None:
    with pytest.raises(ValidationError, match="DEV_LOGIN"):
        Settings(**{**BASE, "environment": "production"}, dev_login=True)  # type: ignore[arg-type]
    for environment in ("development", "test"):
        assert Settings(**{**BASE, "environment": environment}, dev_login=True).dev_login  # type: ignore[arg-type]
