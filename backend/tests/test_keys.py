"""Service keys saved from the apps (Garmin's Personal API key, Anthropic's) instead of the environment."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import httpx
import pytest
import respx
from pydantic import SecretStr
from sqlalchemy import select

from tests.test_activities import SETTINGS, Ctx, ctx  # noqa: F401
from zankup import instance_keys
from zankup.core.config import get_settings
from zankup.db.models import InstanceKey
from zankup.jobs.scheduler import Scheduler
from zankup.sync.garmin import BASE_URL, TOKEN_PATH

GARMIN_KEY = "garmin-personal-key-1234"
ANTHROPIC_KEY = "sk-ant-api03-secret-abcd"


def use(context: Ctx, settings: Any) -> None:
    app: Any = context.http.app
    app.dependency_overrides[get_settings] = lambda: settings


@pytest.fixture
def accept_keys(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str]]:
    tried: list[tuple[str, str]] = []
    monkeypatch.setattr(instance_keys, "check", lambda name, value: tried.append((name, value)))
    return tried


def test_a_key_saved_from_the_apps_is_tried_encrypted_and_never_sent_back(
    ctx: Ctx,  # noqa: F811
    accept_keys: list[tuple[str, str]],
) -> None:
    keys = ctx.http.get("/api/keys").json()
    assert [(k["name"], k["configured"], k["source"]) for k in keys] == [
        ("garmin", False, None),
        ("anthropic", False, None),
        ("resend", False, None),
        ("backup_s3", False, None),
    ]
    assert ctx.http.get("/api/sources").json()[0]["configured"] is False

    expires = (date.today() + timedelta(days=200)).isoformat()
    saved = ctx.http.put("/api/keys/garmin", json={"value": f"  {GARMIN_KEY} ", "expires_on": expires})
    assert saved.status_code == 200
    assert saved.json() == {
        "name": "garmin",
        "configured": True,
        "source": "app",
        "last4": "1234",
        "expires_on": expires,
    }
    assert accept_keys == [("garmin", GARMIN_KEY)]
    assert GARMIN_KEY not in saved.text and GARMIN_KEY not in ctx.http.get("/api/keys").text

    with ctx.sessions() as db:
        row = db.scalars(select(InstanceKey)).one()
        assert GARMIN_KEY.encode() not in row.secret
        current = instance_keys.effective(SETTINGS, db)
    assert current.garmin_personal_api_key is not None
    assert current.garmin_personal_api_key.get_secret_value() == GARMIN_KEY
    assert current.garmin_key_expires_on == date.fromisoformat(expires)
    # The API sees it at once: Garmin is configured for the profile and for syncing.
    assert ctx.http.get("/api/sources").json()[0]["configured"] is True

    removed = ctx.http.delete("/api/keys/garmin").json()
    assert (removed["configured"], removed["source"]) == (False, None)
    assert ctx.http.get("/api/sources").json()[0]["configured"] is False


def test_the_environments_key_is_the_fallback_and_a_saved_one_wins(
    ctx: Ctx,  # noqa: F811
    accept_keys: list[tuple[str, str]],
) -> None:
    env = SETTINGS.model_copy(update={"anthropic_api_key": SecretStr("sk-ant-from-env-wxyz")})
    use(ctx, env)
    anthropic = ctx.http.get("/api/keys").json()[1]
    assert (anthropic["configured"], anthropic["source"], anthropic["last4"]) == (True, "env", "wxyz")

    ctx.http.put("/api/keys/anthropic", json={"value": ANTHROPIC_KEY})
    anthropic = ctx.http.get("/api/keys").json()[1]
    assert (anthropic["source"], anthropic["last4"]) == ("app", "abcd")
    with ctx.sessions() as db:
        key = instance_keys.effective(env, db).anthropic_api_key
    assert key is not None and key.get_secret_value() == ANTHROPIC_KEY

    anthropic = ctx.http.delete("/api/keys/anthropic").json()
    assert (anthropic["source"], anthropic["last4"]) == ("env", "wxyz")


def test_a_refused_key_is_not_saved(ctx: Ctx, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    def refuse(name: str, value: str) -> None:
        raise instance_keys.InvalidKey("Anthropic did not accept this key")

    monkeypatch.setattr(instance_keys, "check", refuse)
    answer = ctx.http.put("/api/keys/anthropic", json={"value": ANTHROPIC_KEY})
    assert answer.status_code == 422 and "did not accept" in answer.text
    assert ctx.http.get("/api/keys").json()[1]["configured"] is False
    assert ctx.http.put("/api/keys/openai", json={"value": ANTHROPIC_KEY}).status_code == 422


def test_keys_are_tried_against_their_service() -> None:
    with respx.mock(assert_all_called=False) as api:
        api.get("https://api.anthropic.com/v1/models").respond(401)
        api.post(f"{BASE_URL}{TOKEN_PATH}").respond(401)
        http = httpx.Client()
        with pytest.raises(instance_keys.InvalidKey):
            instance_keys.check("anthropic", ANTHROPIC_KEY, http)
        with pytest.raises(instance_keys.InvalidKey):
            instance_keys.check("garmin", GARMIN_KEY, http)
        api.get("https://api.anthropic.com/v1/models").respond(200, json={"data": []})
        api.post(f"{BASE_URL}{TOKEN_PATH}").respond(text="header.eyJleHAiOjQxMDI0NDQ4MDB9.sig")
        instance_keys.check("anthropic", ANTHROPIC_KEY, http)
        instance_keys.check("garmin", GARMIN_KEY, http)


def test_the_scheduler_picks_up_a_key_saved_after_it_started(
    ctx: Ctx,  # noqa: F811
    accept_keys: list[tuple[str, str]],
) -> None:
    scheduler = Scheduler(ctx.sessions, interval=None, owner_email="runner@example.com", settings=SETTINGS)
    assert scheduler.tick() is None  # no key: no Garmin sync

    ctx.http.put("/api/keys/garmin", json={"value": GARMIN_KEY})
    assert scheduler.tick() is not None
    assert scheduler.garmin_health and scheduler.interval is not None


# --- settings ----------------------------------------------------------------------------------------


def setting(ctx: Ctx, name: str) -> dict[str, Any]:  # noqa: F811
    return next(s for s in ctx.http.get("/api/instance").json()["settings"] if s["name"] == name)


def test_settings_say_where_each_value_comes_from_and_a_saved_one_wins(ctx: Ctx) -> None:  # noqa: F811
    # A value given to the settings (as the environment gives them) reads as the environment's.
    env = SETTINGS.model_copy(update={"ai_model": "claude-sonnet-5-5"})
    use(ctx, env)
    assert setting(ctx, "ai_model") == {"name": "ai_model", "value": "claude-sonnet-5-5", "source": "env"}
    assert setting(ctx, "ai_monthly_budget_usd") == {
        "name": "ai_monthly_budget_usd",
        "value": 5.0,
        "source": "default",
    }
    models = {m["id"] for m in ctx.http.get("/api/instance").json()["models"]}
    assert {"claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"} <= models

    changed = ctx.http.patch(
        "/api/instance",
        json={"ai_model": "claude-haiku-5-5", "ai_monthly_budget_usd": "12.5", "sync_interval_minutes": 30},
    )
    assert changed.status_code == 200
    values = {s["name"]: (s["value"], s["source"]) for s in changed.json()["settings"]}
    assert values["ai_model"] == ("claude-haiku-5-5", "app")
    assert values["ai_monthly_budget_usd"] == (12.5, "app")
    with ctx.sessions() as db:
        current = instance_keys.effective(env, db)
    assert (current.ai_model, current.ai_monthly_budget_usd, current.sync_interval_minutes) == (
        "claude-haiku-5-5",
        12.5,
        30,
    )

    # null goes back to the environment's value.
    ctx.http.patch("/api/instance", json={"ai_model": None})
    assert setting(ctx, "ai_model")["source"] == "env"


def test_a_setting_the_environment_would_refuse_is_refused(ctx: Ctx) -> None:  # noqa: F811
    for bad in (
        {"weekly_report_hour_utc": 25},
        {"ai_monthly_budget_usd": 0},
        {"alert_email": "nobody"},
        {"database_url": "postgresql://elsewhere"},
    ):
        answer = ctx.http.patch("/api/instance", json=bad)
        assert answer.status_code == 422, bad
    assert setting(ctx, "weekly_report_hour_utc")["source"] == "default"


def test_backups_and_alerts_follow_what_is_saved(
    ctx: Ctx,  # noqa: F811
    accept_keys: list[tuple[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from zankup import alerts

    sent: list[tuple[str, str]] = []
    monkeypatch.setattr(alerts.Email, "send", lambda self, subject, text: sent.append((self.to, subject)))
    send = alerts.lazy_email_sender(SETTINGS, ctx.sessions)
    send("first", "not configured yet")
    assert sent == []

    ctx.http.put("/api/keys/resend", json={"value": "re_123456789"})
    ctx.http.patch("/api/instance", json={"alert_email": "me@example.com", "backup_hour_utc": 4})
    send("second", "now it goes")
    assert sent == [("me@example.com", "second")]

    scheduler = Scheduler(ctx.sessions, interval=None, owner_email="runner@example.com", settings=SETTINGS)
    scheduler.tick()
    assert scheduler.backup_hour is None  # no backup destination yet
    ctx.http.patch("/api/instance", json={"backup_s3_bucket": "zankup-backups"})
    scheduler.tick()
    assert scheduler.backup_hour == 4
