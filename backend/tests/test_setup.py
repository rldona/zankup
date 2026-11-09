"""First-time sign-up (OS-221): setup code, password, TOTP with QR, recovery codes, and closing."""

import hashlib
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import httpx
import pyotp
import pytest
import respx
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from zankup.api.main import create_app
from zankup.auth import rate_limit
from zankup.auth.deps import SESSION_COOKIE
from zankup.auth.setup import PWNED_URL, announce_setup_code, ensure_setup_code
from zankup.core.config import Settings, get_settings
from zankup.db.models import Activity, Device, RecoveryCode, SetupCode, User
from zankup.db.session import get_engine, get_session

SECRET = "test-secret"
SETTINGS = Settings(  # type: ignore[call-arg]
    _env_file=None, environment="test", jwt_secret=SecretStr(SECRET), run_worker=False
)
PASSWORD = "a long and unique passphrase"


@dataclass
class Ctx:
    http: TestClient
    sessions: sessionmaker[Session]
    code: str


@pytest.fixture
def ctx(database: str, monkeypatch: pytest.MonkeyPatch) -> Iterator[Ctx]:
    monkeypatch.setattr(rate_limit, "limiter", rate_limit.LoginLimiter())
    for module in ("zankup.auth.setup", "zankup.auth.routes"):
        monkeypatch.setattr(f"{module}.limiter", rate_limit.limiter)
    engine = create_engine(database)
    sessions = sessionmaker(engine, expire_on_commit=False)

    def session() -> Iterator[Session]:
        with sessions() as db:
            yield db

    with sessions.begin() as db:
        code = ensure_setup_code(db, SECRET)
    assert code is not None
    app = create_app(SETTINGS)
    app.dependency_overrides[get_session] = session
    app.dependency_overrides[get_settings] = lambda: SETTINGS
    app.dependency_overrides[get_engine] = lambda: engine
    yield Ctx(TestClient(app), sessions, code)
    engine.dispose()


@pytest.fixture
def pwned() -> Iterator[respx.Router]:
    """Have I Been Pwned's range API: knows only the password "password123456"."""
    known = hashlib.sha1(b"password123456").hexdigest().upper()
    with respx.mock(assert_all_called=False) as router:
        router.get(url__startswith=PWNED_URL).mock(
            side_effect=lambda request: httpx.Response(
                200,
                text=f"{known[5:]}:9545824\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0"
                if str(request.url).endswith(known[:5])
                else "0000000000000000000000000000000000A:3",
            )
        )
        yield router


def account(ctx: Ctx, **overrides: object) -> httpx.Response:
    body = {
        "code": ctx.code,
        "display_name": "Raúl",
        "email": "Me@Example.com",
        "password": PASSWORD,
        "accept": True,
    }
    return ctx.http.post("/api/setup/account", json=body | overrides)


def next_code(secret: str) -> str:
    return pyotp.TOTP(secret).now()


def test_the_whole_sign_up(ctx: Ctx, pwned: respx.Router) -> None:
    assert ctx.http.get("/api/setup").json() == {"open": True}
    step1 = account(ctx, code=ctx.code.lower().replace("-", " "))  # typed loosely: still accepted
    assert step1.status_code == 200, step1.text
    totp = step1.json()
    assert totp["uri"].startswith("otpauth://totp/Zankup:me%40example.com?secret=")
    assert totp["qr_svg"].startswith("<svg") and totp["secret"] in totp["uri"]
    assert pwned.calls.last.request.url.path.endswith(hashlib.sha1(PASSWORD.encode()).hexdigest().upper()[:5])

    done = ctx.http.post(
        "/api/setup/totp", json={"setup_token": totp["setup_token"], "code": next_code(totp["secret"])}
    )
    assert done.status_code == 200, done.text
    body = done.json()
    assert body["me"]["email"] == "me@example.com" and body["me"]["totp_enabled"] is True
    codes = body["recovery_codes"]
    assert len(codes) == len(set(codes)) == 8 and all(len(c) == 11 and c[5] == "-" for c in codes)
    assert ctx.http.cookies.get(SESSION_COOKIE) and ctx.http.get("/api/auth/me").status_code == 200

    assert ctx.http.get("/api/setup").json() == {"open": False}
    assert account(ctx).status_code == 410  # closed for good, even with the old code
    with ctx.sessions() as db:
        assert db.scalar(select(func.count()).select_from(SetupCode)) == 0
        stored = list(db.scalars(select(RecoveryCode.code_hash)))
        assert len(stored) == 8 and not set(codes) & set(stored)  # only hashes are kept
        user = db.scalars(select(User)).one()
        assert user.display_name == "Raúl"


def test_the_android_app_gets_its_tokens(ctx: Ctx, pwned: respx.Router) -> None:
    totp = account(ctx).json()
    done = ctx.http.post(
        "/api/setup/totp",
        json={
            "setup_token": totp["setup_token"],
            "code": next_code(totp["secret"]),
            "client": "android",
            "device_name": "Pixel",
        },
    )
    assert done.status_code == 200, done.text
    body = done.json()
    assert body["me"]["email"] == "me@example.com" and len(body["recovery_codes"]) == 8
    assert body["tokens"]["refresh_token"] and not ctx.http.cookies.get(SESSION_COOKIE)
    me = ctx.http.get("/api/auth/me", headers={"Authorization": f"Bearer {body['tokens']['access_token']}"})
    assert me.status_code == 200
    with ctx.sessions() as db:
        device = db.scalars(select(Device)).one()
        assert (device.platform, device.name) == ("android", "Pixel")


def test_a_wrong_setup_code_is_refused_and_slowed_down(ctx: Ctx, pwned: respx.Router) -> None:
    statuses = [account(ctx, code="AAAA-BBBB-CCCC").status_code for _ in range(7)]
    assert statuses[:5] == [401] * 5 and statuses[-1] == 429
    assert account(ctx).status_code == 429  # even the right code waits


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"password": "short"}, "at least 12 characters"),
        ({"password": "password123456"}, "known data breaches"),
        ({"accept": False}, "Accept how your data is handled"),
        ({"email": "not-an-email"}, "valid e-mail"),
    ],
)
def test_the_account_must_be_sound(
    ctx: Ctx, pwned: respx.Router, overrides: dict[str, object], message: str
) -> None:
    response = account(ctx, **overrides)
    assert response.status_code == 422 and message in response.text


def test_breach_check_does_not_block_when_the_service_is_down(ctx: Ctx) -> None:
    with respx.mock() as router:
        router.get(url__startswith=PWNED_URL).mock(side_effect=httpx.ConnectError("down"))
        assert account(ctx).status_code == 200


def test_a_wrong_or_stale_totp_step_is_refused(ctx: Ctx, pwned: respx.Router) -> None:
    totp = account(ctx).json()
    wrong = ctx.http.post("/api/setup/totp", json={"setup_token": totp["setup_token"], "code": "000000"})
    assert wrong.status_code == 401 and "does not match" in wrong.text
    forged = ctx.http.post(
        "/api/setup/totp", json={"setup_token": "x.y.z", "code": next_code(totp["secret"])}
    )
    assert forged.status_code == 401
    assert ctx.http.get("/api/setup").json() == {"open": True}  # nothing closed until it works


def test_activities_synced_before_sign_up_stay_with_the_account(ctx: Ctx, pwned: respx.Router) -> None:
    with ctx.sessions.begin() as db:
        owner = User(email="owner@zankup.local")
        db.add(owner)
        db.flush()
        db.add(
            Activity(
                user_id=owner.id,
                source="garmin",
                external_id="1",
                sport="run",
                start_utc=datetime.now(UTC) - timedelta(days=1),
                duration_s=1800,
            )
        )
        owner_id = owner.id
    totp = account(ctx).json()
    ctx.http.post(
        "/api/setup/totp", json={"setup_token": totp["setup_token"], "code": next_code(totp["secret"])}
    )
    with ctx.sessions() as db:
        assert db.scalars(select(User.id)).all() == [owner_id]
        assert db.scalar(select(Activity.user_id)) == owner_id


def test_a_recovery_code_replaces_the_totp_code_once(ctx: Ctx, pwned: respx.Router) -> None:
    totp = account(ctx).json()
    codes = ctx.http.post(
        "/api/setup/totp", json={"setup_token": totp["setup_token"], "code": next_code(totp["secret"])}
    ).json()["recovery_codes"]
    ctx.http.cookies.clear()

    def sign_in(code: str) -> int:
        challenge = ctx.http.post(
            "/api/auth/login", json={"email": "me@example.com", "password": PASSWORD}
        ).json()
        return ctx.http.post(
            "/api/auth/login/totp", json={"challenge": challenge["challenge"], "code": code}
        ).status_code

    assert sign_in(codes[0].upper()) == 200
    assert sign_in(codes[0]) == 401  # spent
    assert sign_in("zzzzz-zzzzz") == 401


def test_the_setup_code_is_announced_and_stable(ctx: Ctx, monkeypatch: pytest.MonkeyPatch) -> None:
    logged: list[str] = []
    monkeypatch.setattr(
        "zankup.auth.setup.log.warning", lambda message, *args, **kwargs: logged.append(message % args)
    )
    with ctx.sessions() as db:
        announce_setup_code(db, SECRET)
    assert logged == [f"Sign-up is open. Create your account at /setup with this setup code: {ctx.code}"]
    with ctx.sessions.begin() as db:
        assert ensure_setup_code(db, SECRET) == ctx.code  # same code on every start
