"""Password recovery (OS-222): link by e-mail plus a code from the app, sessions closed, one use."""

import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import pyotp
import pytest
import respx
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine, func, select, update
from sqlalchemy.orm import Session, sessionmaker

from tests.test_setup import pwned  # noqa: F401 - fixture: Have I Been Pwned's range API
from zankup.admin import set_password
from zankup.api.main import create_app
from zankup.auth import rate_limit
from zankup.auth.recovery import new_recovery_codes
from zankup.auth.security import encrypt_totp_secret, new_token, new_totp_secret
from zankup.core.config import Settings, get_settings
from zankup.db.models import Device, PasswordReset, User, UserSettings
from zankup.db.session import get_engine, get_session

SECRET = "test-secret"
SETTINGS = Settings(  # type: ignore[call-arg]
    _env_file=None,
    environment="test",
    jwt_secret=SecretStr(SECRET),
    run_worker=False,
    webauthn_origins=["https://zankup.test"],
)
NEW = "a brand new long passphrase"


@dataclass
class Ctx:
    http: TestClient
    sessions: sessionmaker[Session]
    totp: str
    codes: list[str]
    mail: list[tuple[str, str, str]] = field(default_factory=list)

    def link_token(self) -> str:
        match = re.search(r"/reset-password\?token=(\S+)", self.mail[-1][2])
        assert match, self.mail[-1]
        return match.group(1)


@pytest.fixture
def ctx(database: str, monkeypatch: pytest.MonkeyPatch) -> Iterator[Ctx]:
    monkeypatch.setattr(rate_limit, "limiter", rate_limit.LoginLimiter())
    monkeypatch.setattr("zankup.auth.password_reset.limiter", rate_limit.limiter)
    engine = create_engine(database)
    sessions = sessionmaker(engine, expire_on_commit=False)

    def session() -> Iterator[Session]:
        with sessions() as db:
            yield db

    totp = new_totp_secret()
    with sessions.begin() as db:
        user = User(
            email="me@example.com",
            totp_secret_enc=encrypt_totp_secret(totp, SECRET),
            totp_enabled_at=datetime.now(UTC),
        )
        db.add(user)
        db.flush()
        db.add(UserSettings(user_id=user.id, language="es", units="metric", theme="system"))
        set_password(db, user, "the old long passphrase")
        codes = new_recovery_codes(db, user)
        for name in ("Browser", "Pixel"):
            db.add(
                Device(
                    user_id=user.id,
                    name=name,
                    platform="web",
                    refresh_token_hash=new_token()[1],
                    expires_at=datetime.now(UTC) + timedelta(hours=1),
                )
            )
    app = create_app(SETTINGS)
    app.dependency_overrides[get_session] = session
    app.dependency_overrides[get_settings] = lambda: SETTINGS
    app.dependency_overrides[get_engine] = lambda: engine
    context = Ctx(TestClient(app), sessions, totp, codes)
    monkeypatch.setattr(
        "zankup.auth.password_reset.send_email",
        lambda _settings, to, subject, text: context.mail.append((to, subject, text)) or True,
    )
    yield context
    engine.dispose()


def forgot(ctx: Ctx, email: str = "me@example.com") -> int:
    return ctx.http.post("/api/auth/password/forgot", json={"email": email}).status_code


def test_reset_with_the_link_and_a_code(ctx: Ctx, pwned: respx.Router) -> None:  # noqa: F811
    assert forgot(ctx, "Me@Example.com") == 202
    to, subject, text = ctx.mail[-1]
    assert to == "me@example.com" and "restablece" in subject  # in the user's language
    assert "https://zankup.test/reset-password?token=" in text
    token = ctx.link_token()
    with ctx.sessions() as db:
        assert db.scalar(select(PasswordReset.token_hash)) != token  # only the hash is stored

    done = ctx.http.post(
        "/api/auth/password/reset", json={"token": token, "password": NEW, "code": pyotp.TOTP(ctx.totp).now()}
    )
    assert done.status_code == 204, done.text
    assert "ha cambiado" in ctx.mail[-1][1]  # the notice
    with ctx.sessions() as db:
        assert db.scalar(select(func.count()).select_from(Device)) == 0  # every session closed
    signed_in = ctx.http.post("/api/auth/login", json={"email": "me@example.com", "password": NEW})
    assert signed_in.status_code == 200
    again = ctx.http.post(
        "/api/auth/password/reset", json={"token": token, "password": NEW + "x", "code": ctx.codes[0]}
    )
    assert again.status_code == 400  # single use


def test_the_answer_does_not_say_whether_the_account_exists(ctx: Ctx) -> None:
    assert forgot(ctx, "nobody@example.com") == 202
    assert ctx.mail == []
    assert forgot(ctx) == 202 and len(ctx.mail) == 1
    assert forgot(ctx) == 202 and len(ctx.mail) == 1  # at most one e-mail a minute


def test_the_mailbox_alone_is_not_enough(ctx: Ctx, pwned: respx.Router) -> None:  # noqa: F811
    forgot(ctx)
    token = ctx.link_token()
    no_code = ctx.http.post(
        "/api/auth/password/reset", json={"token": token, "password": NEW, "code": "000000"}
    )
    assert no_code.status_code == 401
    with_recovery = ctx.http.post(
        "/api/auth/password/reset", json={"token": token, "password": NEW, "code": ctx.codes[1]}
    )
    assert with_recovery.status_code == 204  # a recovery code works instead of the app


def test_links_expire(ctx: Ctx) -> None:
    forgot(ctx)
    with ctx.sessions.begin() as db:
        db.execute(update(PasswordReset).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
    expired = ctx.http.post(
        "/api/auth/password/reset",
        json={"token": ctx.link_token(), "password": NEW, "code": pyotp.TOTP(ctx.totp).now()},
    )
    assert expired.status_code == 400 and "expired" in expired.text
    assert (
        ctx.http.post("/api/auth/password/reset", json={"token": "made-up", "password": NEW}).status_code
        == 400
    )


def test_weak_passwords_are_refused_without_spending_the_code(ctx: Ctx, pwned: respx.Router) -> None:  # noqa: F811
    forgot(ctx)
    token = ctx.link_token()
    short = ctx.http.post(
        "/api/auth/password/reset", json={"token": token, "password": "short", "code": ctx.codes[2]}
    )
    assert short.status_code == 422
    breached = ctx.http.post(
        "/api/auth/password/reset", json={"token": token, "password": "password123456", "code": ctx.codes[3]}
    )
    assert breached.status_code == 422 and "breaches" in breached.text
    good = ctx.http.post(
        "/api/auth/password/reset", json={"token": token, "password": NEW, "code": ctx.codes[2]}
    )
    assert good.status_code == 204  # the recovery code was not spent by the refused attempts


def test_requests_are_rate_limited(ctx: Ctx) -> None:
    statuses = [forgot(ctx, f"x{i}@example.com") for i in range(8)]
    assert statuses[-1] == 429
