"""Milestone 6: health data from several sources (OS-601 to OS-607)."""

from __future__ import annotations

import base64
import json
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import pytest
import respx
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from pydantic import SecretStr
from sqlalchemy import func, select

from tests.test_activities import SETTINGS, Ctx, ctx  # noqa: F401
from zankup.core.config import get_settings
from zankup.db.models import Activity, DailyHealth, Job, SleepSession, Source
from zankup.health import crypto, garmin, google, resolve, webhooks
from zankup.health.store import DayIn, SleepIn, save_day, save_sleep, sleep_score
from zankup.jobs.scheduler import Scheduler
from zankup.sync.garmin import BASE_URL, TOKEN_PATH, GarminClient, MemoryTokenCache

GOOGLE = SETTINGS.model_copy(
    update={
        "google_client_id": "web-client",
        "google_client_secret": SecretStr("s"),
        "google_health_enabled": True,
        "google_health_webhook_secret": SecretStr("hook-secret"),
    }
)
NIGHT = datetime(2026, 11, 7, 22, 30, tzinfo=UTC)  # 23:30 in Madrid


def owner(context: Ctx) -> int:
    with context.sessions() as db:
        return db.get_one(Activity, context.ids["run"]).user_id


def at(minutes: float) -> datetime:
    return NIGHT + timedelta(minutes=minutes)


def use(context: Ctx, settings: Any) -> None:
    app: Any = context.http.app
    app.dependency_overrides[get_settings] = lambda: settings


# --- the model and the score (OS-601) ------------------------------------------------------------------


def test_sleep_score_rewards_duration_efficiency_and_deep_sleep() -> None:
    eight_hours = 8 * 3600
    assert sleep_score(eight_hours, eight_hours + 1200, 6000, 6400) == 100
    assert sleep_score(5 * 3600, 6 * 3600, 2000, 2000) < 60
    assert sleep_score(None, 3600, None, None) is None
    # Without stages, duration and efficiency share the score.
    assert sleep_score(eight_hours, eight_hours, None, None) == 100


def test_a_short_night_with_little_deep_sleep_is_not_rewarded_by_rem() -> None:
    # A real night (9 Nov 2026) that Google Health scored 63: 5 h 56 min asleep, 30 min awake,
    # 1 h 46 min REM, 3 h 33 min light and so 37 min deep. The old formula gave it 80.
    asleep, deep, rem = 356 * 60, 37 * 60, 106 * 60
    score = sleep_score(asleep, asleep + 30 * 60, deep, rem)
    assert score is not None and 60 <= score <= 68
    # With the same deep + REM in all, plenty of REM no longer makes up for little deep sleep.
    balanced = sleep_score(asleep, asleep + 30 * 60, 72 * 60, 71 * 60)
    assert balanced is not None and balanced > score


def test_a_sleep_is_stored_once_with_its_stage_totals(ctx: Ctx) -> None:  # noqa: F811
    user = owner(ctx)
    night = SleepIn(
        external_id="n1",
        start=at(0),
        end=at(480),
        utc_offset_s=3600,
        stages=[
            (at(0), at(20), "awake"),
            (at(20), at(200), "light"),
            (at(200), at(320), "deep"),
            (at(320), at(480), "rem"),
        ],
    )
    for _ in range(2):
        with ctx.sessions.begin() as db:
            save_sleep(db, user, "google_health", night)
    with ctx.sessions() as db:
        rows = list(db.scalars(select(SleepSession)))
    assert len(rows) == 1
    row = rows[0]
    assert row.day == date(2026, 11, 8) and row.asleep_s == 460 * 60 and row.deep_s == 7200
    assert row.stages and row.stages[0] == [0, 1200, "awake"] and row.score and row.score > 80


def test_a_day_keeps_fields_another_call_did_not_send(ctx: Ctx) -> None:  # noqa: F811
    user = owner(ctx)
    with ctx.sessions.begin() as db:
        save_day(db, user, "garmin", DayIn(day=date(2026, 11, 8), external_id="d", resting_hr=50))
        save_day(db, user, "garmin", DayIn(day=date(2026, 11, 8), external_id="d", steps=9000))
    with ctx.sessions() as db:
        row = db.scalars(select(DailyHealth)).one()
    assert (row.resting_hr, row.steps) == (50, 9000)


def test_secrets_are_encrypted_and_bound_to_their_row() -> None:
    blob = crypto.encrypt(SETTINGS, "refresh-token", context="google_health:1")
    assert b"refresh-token" not in blob
    assert crypto.decrypt(SETTINGS, blob, context="google_health:1") == "refresh-token"
    assert crypto.decrypt(SETTINGS, blob, context="google_health:2") is None
    other = SETTINGS.model_copy(update={"jwt_secret": SecretStr("rotated")})
    assert crypto.decrypt(other, blob, context="google_health:1") is None


# --- Garmin (OS-602) ------------------------------------------------------------------------------------


def ms(when: datetime) -> int:
    return int(when.timestamp() * 1000)


GARMIN_SLEEP = {
    "id": 1799,
    "calendarDate": "2026-11-08",
    "sleepStartTimestampGMT": ms(at(0)),
    "sleepEndTimestampGMT": ms(at(450)),
    "sleepStartTimestampLocal": ms(at(60)),
    "sleepTimeSeconds": 420 * 60,
    "deepSleepSeconds": 5400,
    "lightSleepSeconds": 13200,
    "remSleepSeconds": 6600,
    "awakeSleepSeconds": 1800,
    "averageSpO2Value": 95.0,
    "averageRespirationValue": 14.5,
}


@pytest.fixture
def garmin_health() -> Any:
    with respx.mock(base_url=BASE_URL, assert_all_called=False) as api:
        api.post(TOKEN_PATH).respond(text="header.eyJleHAiOjQxMDI0NDQ4MDB9.sig")
        api.get(path__regex=r"/hrv-service/hrv/daily/.*").respond(
            json={"hrvSummaries": [{"calendarDate": "2026-11-08", "lastNightAvg": 48}]}
        )
        api.get(path__regex=r"/usersummary-service/stats/steps/daily/.*").respond(
            json=[
                {"calendarDate": "2026-11-08", "totalSteps": 8123},
                {"calendarDate": "2026-11-07", "totalSteps": None},
            ]
        )

        def sleep(request: httpx.Request) -> httpx.Response:
            if request.url.params["date"] == "2026-11-08":
                return httpx.Response(200, json=GARMIN_SLEEP)
            return httpx.Response(200, json={"id": None, "calendarDate": None})

        def heart(request: httpx.Request) -> httpx.Response:
            day = request.url.params["date"]
            start = ms(datetime.fromisoformat(day).replace(tzinfo=UTC))
            # Garmin lists the samples it has: 600 two-minute readings, then nothing.
            values = [[start + i * 120_000, 60] for i in range(600)]
            return httpx.Response(
                200, json={"calendarDate": day, "restingHeartRate": 52, "heartRateValues": values}
            )

        api.get("/sleep-service/sleep/dailySleep").mock(side_effect=sleep)
        api.get("/wellness-service/wellness/dailyHeartRate").mock(side_effect=heart)
        yield api


def test_garmin_health_sync_saves_sleep_and_daily_figures(ctx: Ctx, garmin_health: Any) -> None:  # noqa: F811
    user = owner(ctx)
    client = GarminClient("key", MemoryTokenCache(), sleep=lambda _: None)
    fetched = garmin.sync_health(
        ctx.sessions, client, user, since=date(2026, 11, 7), today=date(2026, 11, 8), sleep=lambda _: None
    )
    assert fetched == 2
    with ctx.sessions() as db:
        night = db.scalars(select(SleepSession)).one()
        days = {d.day: d for d in db.scalars(select(DailyHealth))}
        cursor = db.scalars(select(Source.sync_cursor).where(Source.kind == "garmin")).one()
    assert night.source == "garmin" and night.utc_offset_s == 3600 and night.day == date(2026, 11, 8)
    assert (night.deep_s, night.rem_s, night.asleep_s) == (5400, 6600, 420 * 60)
    today = days[date(2026, 11, 8)]
    assert (today.hrv_ms, today.steps, today.resting_hr, today.spo2, today.respiration) == (
        48,
        8123,
        52,
        95,
        14.5,
    )
    assert today.wear_s == 600 * 120  # 600 two-minute samples
    assert cursor and cursor["health"]["until"] == "2026-11-08"


def test_garmin_without_hrv_answers_no_content(ctx: Ctx, garmin_health: Any) -> None:  # noqa: F811
    garmin_health.get(path__regex=r"/hrv-service/hrv/daily/.*").respond(204)
    client = GarminClient("key", MemoryTokenCache(), sleep=lambda _: None)
    garmin.sync_health(
        ctx.sessions,
        client,
        owner(ctx),
        since=date(2026, 11, 8),
        today=date(2026, 11, 8),
        sleep=lambda _: None,
    )
    with ctx.sessions() as db:
        assert db.scalars(select(DailyHealth.hrv_ms)).one() is None


def test_garmin_health_asks_for_ranges_four_weeks_at_a_time(ctx: Ctx, garmin_health: Any) -> None:  # noqa: F811
    client = GarminClient("key", MemoryTokenCache(), sleep=lambda _: None)
    garmin.sync_health(
        ctx.sessions,
        client,
        owner(ctx),
        since=date(2026, 10, 1),
        today=date(2026, 11, 8),
        sleep=lambda _: None,
    )
    asked = [
        call.request.url.path
        for call in garmin_health.calls
        if call.request.url.path.startswith("/hrv-service/hrv/daily/")
    ]
    assert asked == [
        "/hrv-service/hrv/daily/2026-10-01/2026-10-28",
        "/hrv-service/hrv/daily/2026-10-29/2026-11-08",
    ]


def test_a_years_history_is_queued_for_each_connected_source(ctx: Ctx) -> None:  # noqa: F811
    use(ctx, GOOGLE.model_copy(update={"garmin_personal_api_key": SecretStr("k")}))
    user = owner(ctx)
    assert ctx.http.post("/api/wellness/history").json() == {"queued": []}
    with ctx.sessions.begin() as db:
        db.add(Source(user_id=user, kind="garmin"))
        db.add(Source(user_id=user, kind="google_health"))
    assert ctx.http.post("/api/wellness/history").json() == {"queued": ["garmin", "google_health"]}
    with ctx.sessions() as db:
        jobs = {j.kind: j.payload for j in db.scalars(select(Job).where(Job.kind.like("sync_%_health")))}
    since = (datetime.now(UTC).date() - timedelta(days=365)).isoformat()
    assert jobs == {"sync_garmin_health": {"since": since}, "sync_google_health": {"since": since}}


# --- Google Health (OS-603) -----------------------------------------------------------------------------


def connect_google(context: Ctx, user: int) -> None:
    with context.sessions.begin() as db:
        google.connect(
            db,
            GOOGLE,
            user,
            {
                "refresh_token": "refresh-1",
                "access_token": "old",
                "expires_in": -1,
                "scope": " ".join(google.SCOPES),
            },
            "health-user-1",
        )


def google_point(kind: str, field: str, day: str, **values: Any) -> dict[str, Any]:
    y, m, d = (int(x) for x in day.split("-"))
    return {
        "name": f"users/me/dataTypes/{kind}/dataPoints/{kind}-{day}",
        field: {"date": {"year": y, "month": m, "day": d}, **values},
    }


@pytest.fixture
def google_api() -> Any:
    with respx.mock(assert_all_called=False) as api:
        api.post(google.TOKEN_URL).respond(json={"access_token": "fresh", "expires_in": 3600})
        base = google.BASE_URL + "/users/me/dataTypes"
        sleep_point = {
            "name": "users/me/dataTypes/sleep/dataPoints/s1",
            "sleep": {
                "interval": {
                    "startTime": at(0).isoformat().replace("+00:00", "Z"),
                    "endTime": at(470).isoformat().replace("+00:00", "Z"),
                    "endUtcOffset": "3600s",
                },
                "type": "STAGES",
                "stages": [
                    {"startTime": at(0).isoformat(), "endTime": at(30).isoformat(), "type": "AWAKE"},
                    {"startTime": at(30).isoformat(), "endTime": at(250).isoformat(), "type": "LIGHT"},
                    {"startTime": at(250).isoformat(), "endTime": at(350).isoformat(), "type": "DEEP"},
                    {"startTime": at(350).isoformat(), "endTime": at(470).isoformat(), "type": "REM"},
                ],
                "summary": {"minutesAsleep": "440", "minutesAwake": "30"},
                "metadata": {"main": True},
            },
        }
        nap = {
            "name": "users/me/dataTypes/sleep/dataPoints/nap",
            "sleep": {
                "interval": {
                    "startTime": "2026-11-08T14:00:00Z",
                    "endTime": "2026-11-08T14:30:00Z",
                    "endUtcOffset": "3600s",
                },
                "summary": {"minutesAsleep": "25"},
                "metadata": {"main": False},
            },
        }

        def sleep(request: httpx.Request) -> httpx.Response:
            assert request.headers["Authorization"] == "Bearer fresh"
            assert request.url.params["filter"].startswith("sleep.interval.civil_end_time >= ")
            if request.url.params.get("pageToken") == "p2":
                return httpx.Response(200, json={"dataPoints": [nap], "nextPageToken": ""})
            return httpx.Response(200, json={"dataPoints": [sleep_point], "nextPageToken": "p2"})

        api.get(f"{base}/sleep/dataPoints").mock(side_effect=sleep)
        api.get(f"{base}/daily-resting-heart-rate/dataPoints").respond(
            json={
                "dataPoints": [
                    google_point(
                        "daily-resting-heart-rate", "dailyRestingHeartRate", "2026-11-08", beatsPerMinute="49"
                    )
                ]
            }
        )
        api.get(f"{base}/daily-heart-rate-variability/dataPoints").respond(
            json={
                "dataPoints": [
                    google_point(
                        "daily-heart-rate-variability",
                        "dailyHeartRateVariability",
                        "2026-11-08",
                        averageHeartRateVariabilityMilliseconds=55.5,
                    )
                ]
            }
        )
        api.get(f"{base}/daily-oxygen-saturation/dataPoints").respond(
            403,
            json={"error": {"status": "PERMISSION_DENIED", "details": [{"reason": "MISSING_OAUTH_SCOPE"}]}},
        )
        api.get(f"{base}/daily-respiratory-rate/dataPoints").respond(json={})
        api.post(f"{base}/steps/dataPoints:dailyRollUp").respond(
            json={
                "rollupDataPoints": [
                    {
                        "civilStartTime": {"date": {"year": 2026, "month": 11, "day": 8}},
                        "steps": {"countSum": "10500"},
                    }
                ]
            }
        )
        hours = [
            {
                "startTime": f"2026-11-08T{h:02d}:00:00Z",
                "endTime": f"2026-11-08T{h:02d}:59:59Z",
                "heartRate": {"beatsPerMinuteAvg": 60},
            }
            for h in range(0, 20)
        ]
        api.post(f"{base}/heart-rate/dataPoints:rollUp").respond(json={"rollupDataPoints": hours})
        yield api


def test_google_health_sync_saves_nights_and_days(ctx: Ctx, google_api: Any) -> None:  # noqa: F811
    user = owner(ctx)
    connect_google(ctx, user)
    google.sync(ctx.sessions, GOOGLE, user, since=date(2026, 11, 7), today=date(2026, 11, 8))
    with ctx.sessions() as db:
        nights = {s.external_id: s for s in db.scalars(select(SleepSession))}
        day = db.scalars(select(DailyHealth).where(DailyHealth.day == date(2026, 11, 8))).one()
        source = db.scalars(select(Source).where(Source.kind == "google_health")).one()
    assert nights["s1"].deep_s == 6000 and nights["s1"].asleep_s == 440 * 60 and not nights["s1"].nap
    assert nights["nap"].nap
    assert (day.resting_hr, day.hrv_ms, day.steps, day.spo2) == (49, 55.5, 10500, None)
    assert day.wear_s is not None and day.wear_s >= 19 * 3600
    cursor = source.sync_cursor or {}
    assert cursor["missing"] == ["health_metrics_and_measurements"] and cursor["until"] == "2026-11-08"
    assert source.access_token == "fresh" and source.last_sync_at is not None
    # The refresh token is only ever stored encrypted.
    assert source.secret and b"refresh-1" not in source.secret


def test_a_refused_refresh_token_asks_to_connect_again(ctx: Ctx, google_api: Any) -> None:  # noqa: F811
    user = owner(ctx)
    connect_google(ctx, user)
    google_api.post(google.TOKEN_URL).respond(400, json={"error": "invalid_grant"})
    google.sync(ctx.sessions, GOOGLE, user, since=date(2026, 11, 8), today=date(2026, 11, 8))
    with ctx.sessions() as db:
        source = db.scalars(select(Source).where(Source.kind == "google_health")).one()
        assert (source.sync_cursor or {}).get("reauth") is True
        assert not google.due(db, user, datetime.now(UTC))
    use(ctx, GOOGLE)
    status = next(
        s for s in ctx.http.get("/api/wellness/settings").json()["sources"] if s["source"] == "google_health"
    )
    assert status["connected"] and status["needs_reconnect"]


def test_connecting_google_health_asks_for_read_only_health_scopes(ctx: Ctx) -> None:  # noqa: F811
    assert ctx.http.get("/api/wellness/google/start", follow_redirects=False).status_code == 404  # off
    use(ctx, GOOGLE)
    response = ctx.http.get("/api/wellness/google/start", follow_redirects=False)
    assert response.status_code == 303
    location = response.headers["location"]
    assert "googlehealth.sleep.readonly" in location and "access_type=offline" in location
    assert "redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fapi%2Fwellness%2Fgoogle%2Fcallback" in location
    # Back from Google without the flow cookie: refused.
    ctx.http.cookies.delete("zankup_google_health", path="/api/wellness/google")
    back = ctx.http.get("/api/wellness/google/callback?code=c&state=s", follow_redirects=False)
    assert back.headers["location"].endswith("/settings?health=error#health")


def test_the_google_callback_keeps_the_tokens_and_queues_a_sync(
    ctx: Ctx,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    use(ctx, GOOGLE)
    start = ctx.http.get("/api/wellness/google/start", follow_redirects=False)
    state = httpx.URL(start.headers["location"]).params["state"]
    monkeypatch.setattr(
        "zankup.health.google.exchange_code",
        lambda *a, **k: {
            "refresh_token": "r",
            "access_token": "a",
            "expires_in": 3600,
            "scope": google.SCOPES[0],
        },
    )
    back = ctx.http.get(f"/api/wellness/google/callback?code=c&state={state}", follow_redirects=False)
    assert back.headers["location"].endswith("/settings?health=connected#health")
    with ctx.sessions() as db:
        source = db.scalars(select(Source).where(Source.kind == "google_health")).one()
        assert sorted((source.sync_cursor or {})["missing"]) == [
            "activity_and_fitness",
            "health_metrics_and_measurements",
        ]
        assert db.scalar(select(func.count()).select_from(Job).where(Job.kind == "sync_google_health")) == 1


# --- webhooks (OS-604) ----------------------------------------------------------------------------------


def _field(number: int, data: bytes) -> bytes:
    return bytes([number << 3 | 2, len(data)]) + data


def tink_keyset(key: ec.EllipticCurvePrivateKey, key_id: int) -> dict[str, Any]:
    numbers = key.public_key().public_numbers()
    proto = (
        b"\x08\x00"
        + _field(2, b"\x08\x03")
        + _field(3, b"\x00" + numbers.x.to_bytes(32, "big"))
        + _field(4, numbers.y.to_bytes(32, "big"))
    )
    return {
        "primaryKeyId": key_id,
        "key": [
            {
                "keyData": {
                    "typeUrl": "type.googleapis.com/google.crypto.tink.EcdsaPublicKey",
                    "value": base64.b64encode(proto).decode(),
                },
                "status": "ENABLED",
                "keyId": key_id,
                "outputPrefixType": "TINK",
            }
        ],
    }


def sign(key: ec.EllipticCurvePrivateKey, key_id: int, body: bytes) -> str:
    return base64.b64encode(
        b"\x01" + key_id.to_bytes(4, "big") + key.sign(body, ec.ECDSA(hashes.SHA256()))
    ).decode()


def test_webhooks_check_the_secret_and_signature_then_queue_a_sync(
    ctx: Ctx,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    url = "/api/webhooks/google-health"
    assert ctx.http.post(url, json={"type": "verification"}).status_code == 404  # not set up
    use(ctx, GOOGLE)
    user = owner(ctx)
    connect_google(ctx, user)
    # Google's two verification requests: with the secret, and without it.
    assert (
        ctx.http.post(
            url, json={"type": "verification"}, headers={"Authorization": "hook-secret"}
        ).status_code
        == 200
    )
    assert ctx.http.post(url, json={"type": "verification"}).status_code == 401

    key, key_id = ec.generate_private_key(ec.SECP256R1()), 123456789
    keyset = tink_keyset(key, key_id)
    monkeypatch.setattr(
        webhooks,
        "KEYS",
        webhooks.Keys(
            http=httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=keyset)))
        ),
    )
    body = json.dumps(
        [{"data": {"healthUserId": "health-user-1", "operation": "UPSERT", "dataType": "sleep"}}]
    ).encode()
    headers = {"Authorization": "hook-secret", "Content-Type": "application/json"}
    forged = sign(ec.generate_private_key(ec.SECP256R1()), key_id, body)
    assert (
        ctx.http.post(url, content=body, headers={**headers, webhooks.SIGNATURE_HEADER: forged}).status_code
        == 401
    )
    good = {**headers, webhooks.SIGNATURE_HEADER: sign(key, key_id, body)}
    for _ in range(2):  # the second one, in the same minute, adds nothing
        assert ctx.http.post(url, content=body, headers=good).status_code == 204
    with ctx.sessions() as db:
        assert db.scalar(select(func.count()).select_from(Job).where(Job.kind == "sync_google_health")) == 1


# --- choosing between sources and readiness (OS-605, OS-606) --------------------------------------------


def two_sources(context: Ctx, user: int) -> None:
    """Ten nights from Garmin (no stages) and Google (stages), the last one on 8 Nov."""
    with context.sessions.begin() as db:
        for i in range(10):
            start = NIGHT - timedelta(days=9 - i)
            day = (start + timedelta(hours=10)).date()
            save_sleep(
                db,
                user,
                "garmin",
                SleepIn(
                    external_id=f"g{i}",
                    start=start,
                    end=start + timedelta(hours=8),
                    asleep_s=7 * 3600,
                    awake_s=3600,
                ),
            )
            save_sleep(
                db,
                user,
                "google_health",
                SleepIn(
                    external_id=f"f{i}",
                    start=start,
                    end=start + timedelta(hours=7, minutes=50),
                    stages=[
                        (start, start + timedelta(hours=4), "light"),
                        (start + timedelta(hours=4), start + timedelta(hours=7, minutes=50), "deep"),
                    ],
                ),
            )
            last = i == 9
            save_day(
                db,
                user,
                "garmin",
                DayIn(
                    day=day,
                    external_id="d",
                    resting_hr=50 + i % 2,
                    hrv_ms=40 + i % 3,
                    wear_s=20 * 3600,
                    steps=9000,
                ),
            )
            save_day(
                db,
                user,
                "google_health",
                DayIn(
                    day=day,
                    external_id="d",
                    resting_hr=55,
                    hrv_ms=70 if last else 50 + i % 3,
                    wear_s=8 * 3600,
                    steps=7000,
                ),
            )


def test_automatic_rules_pick_one_value_per_day(ctx: Ctx) -> None:  # noqa: F811
    user = owner(ctx)
    two_sources(ctx, user)
    with ctx.sessions() as db:
        last = resolve.days(db, user, date(2026, 11, 8), date(2026, 11, 9))[0]
    assert last.sleep is not None and last.sleep.source == "google_health" and last.sleep_others == ["garmin"]
    assert last.values["hrv"].source == "google_health"  # overnight: the source of the chosen sleep
    assert last.values["resting_hr"].source == "garmin"  # worn longest
    assert last.values["steps"].value == 9000 and last.values["steps"].others == ["google_health"]
    assert last.readiness is not None and last.readiness.hrv is not None and last.readiness.hrv > 70


def test_the_dashboard_and_priorities_through_the_api(ctx: Ctx) -> None:  # noqa: F811
    user = owner(ctx)
    two_sources(ctx, user)
    days = ctx.http.get("/api/wellness/days?start=2026-11-01&end=2026-11-09").json()
    assert [d["day"] for d in days][-1] == "2026-11-08"
    assert days[-1]["sleep"]["source"] == "google_health" and days[-1]["sleep"]["others"] == ["garmin"]
    assert days[-1]["readiness"]["score"] > 0

    changed = ctx.http.put(
        "/api/wellness/priority", json={"priority": {"sleep": ["garmin"], "hrv": ["garmin", "garmin"]}}
    )
    assert changed.json()["priority"]["sleep"] == ["garmin"] and changed.json()["priority"]["hrv"] == [
        "garmin"
    ]
    days = ctx.http.get("/api/wellness/days?start=2026-11-08&end=2026-11-09").json()
    assert days[0]["sleep"]["source"] == "garmin" and days[0]["hrv"]["source"] == "garmin"

    night = ctx.http.get("/api/wellness/nights/2026-11-08").json()
    assert night["chosen"]["source"] == "garmin" and [a["source"] for a in night["alternatives"]] == [
        "google_health"
    ]
    assert ctx.http.get("/api/wellness/nights/2020-01-01").status_code == 404

    ctx.http.put("/api/wellness/priority", json={"priority": {"sleep": []}})  # back to automatic
    assert ctx.http.get("/api/wellness/nights/2026-11-08").json()["chosen"]["source"] == "google_health"
    assert ctx.http.get("/api/wellness/days?start=2026-01-01&end=2027-06-01").status_code == 422

    with ctx.sessions.begin() as db:
        db.add(
            Source(
                user_id=user, kind="garmin", sync_cursor={"health": {"until": "2026-11-08"}, "no_fit": ["1"]}
            )
        )
    assert ctx.http.delete("/api/wellness/sources/garmin/data").status_code == 204
    with ctx.sessions() as db:
        assert db.scalars(select(Source.sync_cursor).where(Source.kind == "garmin")).one() == {
            "no_fit": ["1"]
        }
    settings = {s["source"]: s for s in ctx.http.get("/api/wellness/settings").json()["sources"]}
    assert settings["garmin"]["nights"] == 0 and settings["google_health"]["nights"] == 10
    assert not settings["google_health"]["available"]  # not configured on this instance


def test_health_connect_uploads_are_upserted(ctx: Ctx) -> None:  # noqa: F811
    body = {
        "sleep": [
            {
                "id": "hc-1",
                "origin": "com.google.android.apps.fitness",
                "start": at(0).isoformat(),
                "end": at(480).isoformat(),
                "utc_offset_s": 3600,
                "stages": [
                    {"start": at(0).isoformat(), "end": at(240).isoformat(), "stage": "light"},
                    {"start": at(240).isoformat(), "end": at(480).isoformat(), "stage": "rem"},
                ],
            }
        ],
        "days": [{"day": "2026-11-08", "resting_hr": 51, "steps": 4000}],
    }
    for _ in range(2):
        assert ctx.http.post("/api/wellness/health-connect", json=body).json() == {"sleep": 1, "days": 1}
    with ctx.sessions() as db:
        night = db.scalars(select(SleepSession)).one()
        assert night.source == "health_connect" and night.origin == "com.google.android.apps.fitness"
        assert night.rem_s == 4 * 3600
        assert db.scalars(select(DailyHealth.steps)).one() == 4000
    bad = {"days": [{"day": "2026-11-08", "spo2": 140}]}
    assert ctx.http.post("/api/wellness/health-connect", json=bad).status_code == 422


def test_health_routes_need_a_session(ctx: Ctx) -> None:  # noqa: F811
    ctx.http.cookies.clear()
    for path in ("/api/wellness/days", "/api/wellness/settings", "/api/wellness/nights/2026-11-08"):
        assert ctx.http.get(path).status_code == 401
    assert ctx.http.post("/api/wellness/health-connect", json={}).status_code == 401


def test_the_scheduler_queues_hourly_health_syncs(ctx: Ctx) -> None:  # noqa: F811
    user = owner(ctx)
    connect_google(ctx, user)
    with ctx.sessions() as db:
        email = db.scalar(select(Source.user_id).where(Source.kind == "google_health"))
        assert email == user
    s = Scheduler(
        ctx.sessions, interval=None, owner_email="runner@example.com", garmin_health=True, google_health=True
    )
    when = datetime(2026, 11, 9, 8, 10, tzinfo=UTC)
    for _ in range(3):
        s.tick(when)
    with ctx.sessions() as db:
        kinds = sorted(db.scalars(select(Job.kind).where(Job.kind.like("sync_%_health"))))
    assert kinds == ["sync_garmin_health", "sync_google_health"]


def test_garmin_resting_hr_from_a_barely_worn_day_is_left_out() -> None:
    start = ms(datetime(2026, 9, 1, tzinfo=UTC))
    sparse = [[start + i * 1_800_000, 120] for i in range(45)]  # 45 readings spread over the day
    day = garmin.parse_heart_rate(
        {"calendarDate": "2026-09-01", "restingHeartRate": 126, "heartRateValues": sparse}
    )
    assert day is not None and day.wear_s == 45 * 120 and day.resting_hr is None
    worn = [[start + i * 120_000, 60] for i in range(400)]
    day = garmin.parse_heart_rate(
        {"calendarDate": "2026-09-01", "restingHeartRate": 52, "heartRateValues": worn}
    )
    assert day is not None and day.resting_hr == 52


def test_the_migration_recomputes_scores_with_the_same_formula() -> None:
    import importlib.util
    from pathlib import Path

    import zankup.db.migrations as migrations

    path = Path(migrations.__path__[0]) / "versions" / "20261109_7c3e91d2a4b6_sleep_score_v2.py"
    spec = importlib.util.spec_from_file_location("sleep_score_v2", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for asleep, in_bed, deep, rem in [
        (356 * 60, 386 * 60, 37 * 60, 106 * 60),
        (28800, 30000, 6000, 6400),
        (18000, 21600, None, None),
        (25000, 27000, 0, 0),
        (None, 3600, None, None),
    ]:
        assert module.score(asleep, in_bed, deep, rem) == sleep_score(asleep, in_bed, deep, rem)
