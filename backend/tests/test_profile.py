"""Profile (OS-218): editing it, the summary, open sessions and the state of the sources."""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from zankup.api.main import create_app
from zankup.api.profile import streak
from zankup.auth.deps import SESSION_COOKIE
from zankup.auth.security import new_token
from zankup.core.config import Settings, get_settings
from zankup.db.models import Activity, BestEffort, Device, SyncRun, User
from zankup.db.session import get_engine, get_session

SETTINGS = Settings(  # type: ignore[call-arg]
    _env_file=None,
    environment="test",
    jwt_secret=SecretStr("test-secret"),
    run_worker=False,
    garmin_personal_api_key=SecretStr("key"),
    garmin_key_expires_on=datetime.now(UTC).date() + timedelta(days=10),
)


@dataclass
class Ctx:
    http: TestClient
    sessions: sessionmaker[Session]
    user_id: int
    device_id: int


@pytest.fixture
def ctx(database: str) -> Iterator[Ctx]:
    engine = create_engine(database)
    sessions = sessionmaker(engine, expire_on_commit=False)

    def session() -> Iterator[Session]:
        with sessions() as db:
            yield db

    token, digest = new_token()
    with sessions.begin() as db:
        user = User(email="runner@example.com", display_name="Runner")
        db.add(user)
        db.flush()
        device = Device(
            user_id=user.id,
            name="Browser",
            platform="web",
            refresh_token_hash=digest,
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
        db.add(device)
        db.flush()
        user_id, device_id = user.id, device.id
    app = create_app(SETTINGS)
    app.dependency_overrides[get_session] = session
    app.dependency_overrides[get_settings] = lambda: SETTINGS
    app.dependency_overrides[get_engine] = lambda: engine
    http = TestClient(app)
    http.cookies.set(SESSION_COOKIE, token)
    yield Ctx(http, sessions, user_id, device_id)
    engine.dispose()


def test_streak_counts_weeks_in_a_row() -> None:
    today = date(2026, 11, 8)  # a Sunday
    monday = date(2026, 11, 2)
    weeks = {monday, monday - timedelta(weeks=1), monday - timedelta(weeks=2), monday - timedelta(weeks=4)}
    assert streak(weeks, today) == 3
    assert streak(weeks - {monday}, today) == 2  # nothing yet this week: counts from last week
    assert streak(weeks - {monday, monday - timedelta(weeks=1)}, today) == 0  # both empty


def test_edit_the_profile(ctx: Ctx) -> None:
    changed = ctx.http.patch(
        "/api/auth/me",
        json={
            "location": " Madrid ",
            "birth_date": "1985-04-02",
            "sex": "male",
            "weight_kg": 72.5,
            "height_cm": 178,
        },
    ).json()
    assert changed["location"] == "Madrid" and changed["birth_date"] == "1985-04-02"
    assert (changed["sex"], changed["weight_kg"], changed["height_cm"]) == ("male", 72.5, 178)
    assert changed["display_name"] == "Runner"  # not sent, not changed
    cleared = ctx.http.patch("/api/auth/me", json={"location": None, "display_name": "Raúl"}).json()
    assert cleared["location"] is None and cleared["display_name"] == "Raúl"
    assert ctx.http.patch("/api/auth/me", json={"birth_date": "2999-01-01"}).status_code == 422
    assert ctx.http.patch("/api/auth/me", json={"sex": "x"}).status_code == 422
    assert ctx.http.patch("/api/auth/me", json={"weight_kg": 5}).status_code == 422


def test_summary(ctx: Ctx) -> None:
    now = datetime.now(UTC)
    with ctx.sessions.begin() as db:
        runs = []
        for i, (sport, distance) in enumerate([("run", 10000), ("run", 5000), ("ride", 40000)]):
            activity = Activity(
                user_id=ctx.user_id,
                source="garmin",
                external_id=str(i),
                sport=sport,
                start_utc=now - timedelta(days=i),
                duration_s=3600,
                moving_s=3000,
                distance_m=distance,
                ascent_m=100,
                device="fēnix 6X Pro" if i == 0 else "Edge",
            )
            db.add(activity)
            db.flush()
            runs.append(activity)
        db.add(
            Activity(
                user_id=ctx.user_id,
                source="garmin",
                external_id="old",
                sport="run",
                start_utc=datetime(2015, 5, 1, tzinfo=UTC),
                duration_s=1800,
                distance_m=5000,
            )
        )
        for activity, seconds in ((runs[0], 1500), (runs[1], 1400)):
            db.add(
                BestEffort(
                    activity_id=activity.id,
                    user_id=ctx.user_id,
                    distance_key="5k",
                    distance_m=5000,
                    time_s=seconds,
                    start_s=0,
                    start_distance_m=0,
                )
            )
    summary = ctx.http.get("/api/profile/summary").json()
    assert summary["year"] == now.year
    this_year = {s["sport"]: s for s in summary["this_year"]}
    if now.timetuple().tm_yday > 3:  # all three in this calendar year
        assert this_year["run"]["count"] == 2 and this_year["run"]["distance_m"] == 15000
    all_time = {s["sport"]: s for s in summary["all_time"]}
    assert all_time["run"]["count"] == 3 and summary["all_time"][0]["sport"] == "run"
    assert summary["since"].startswith("2015-05-01")
    assert summary["records"] == [
        {
            "distance_key": "5k",
            "distance_m": 5000,
            "time_s": 1400,
            "activity_id": runs[1].id,
            "date": summary["records"][0]["date"],
        }
    ]
    assert summary["streak_weeks"] >= 1 and summary["device"] == "fēnix 6X Pro"


def test_sessions_can_be_listed_and_closed(ctx: Ctx) -> None:
    with ctx.sessions.begin() as db:
        phone = Device(user_id=ctx.user_id, name="Pixel", platform="android", last_seen=datetime.now(UTC))
        db.add(phone)
        db.flush()
        phone_id = phone.id
    devices = ctx.http.get("/api/auth/devices").json()
    assert {d["name"]: d["current"] for d in devices} == {"Browser": True, "Pixel": False}
    assert ctx.http.delete(f"/api/auth/devices/{ctx.device_id}").status_code == 409  # not this one
    assert ctx.http.delete(f"/api/auth/devices/{phone_id}").status_code == 204
    assert ctx.http.delete(f"/api/auth/devices/{phone_id}").status_code == 404
    with ctx.sessions() as db:
        assert db.scalars(select(Device.name)).all() == ["Browser"]


def test_garmin_status(ctx: Ctx) -> None:
    with ctx.sessions.begin() as db:
        db.add(SyncRun(user_id=ctx.user_id, trigger="cron", status="error", error="Garmin is down"))
    [garmin] = ctx.http.get("/api/sources").json()
    assert garmin["configured"] is True and garmin["expiring_soon"] is True
    assert garmin["last_error"] == "Garmin is down" and garmin["last_sync_at"] is None
