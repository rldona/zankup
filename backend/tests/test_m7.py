"""The AI assistant (phase 7, OS-701 to OS-709), with a fake SDK client: nothing here calls Anthropic."""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from zankup.ai import ai_preferences
from zankup.ai.client import Llm, LlmBudgetExceeded, Usage, cost_usd
from zankup.ai.coach import answer_text
from zankup.ai.context import FORBIDDEN_KEYS, activity_context, assert_minimised, weekly_context
from zankup.ai.summary import generate_summary, maybe_queue_summary
from zankup.ai.tools import ToolError, run_tool, tool_specs
from zankup.ai.weekly import last_week_start, queue_weekly, weekly_handler, weekly_poll_handler
from zankup.api.ai import get_llm
from zankup.api.main import create_app
from zankup.auth.deps import SESSION_COOKIE
from zankup.auth.security import new_token
from zankup.core.config import Settings, get_settings
from zankup.db.models import (
    Activity,
    ActivityMetrics,
    ActivitySummary,
    BestEffort,
    DailyHealth,
    DailyLoad,
    Device,
    EstimateRow,
    Event,
    Job,
    LlmCall,
    SleepSession,
    User,
    UserSettings,
    WeeklyReport,
)
from zankup.db.session import get_engine, get_session
from zankup.jobs.scheduler import Scheduler
from zankup.notify import message

SETTINGS = Settings(
    _env_file=None,  # type: ignore[call-arg]
    environment="test",
    jwt_secret=SecretStr("test-secret"),
    run_worker=False,
    anthropic_api_key=SecretStr("sk-ant-test"),
)
NO_AI = Settings(_env_file=None, environment="test", jwt_secret=SecretStr("test-secret"), run_worker=False)  # type: ignore[call-arg]
MONDAY = date(2026, 11, 2)
RUN_START = datetime(2026, 11, 4, 7, 30, tzinfo=UTC)  # a Wednesday, in the week of MONDAY


# --- a fake SDK client --------------------------------------------------------------------------------


def usage(input_tokens: int = 3000, output_tokens: int = 300, cache_read: int = 0) -> SimpleNamespace:
    return SimpleNamespace(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_input_tokens=cache_read,
        cache_creation_input_tokens=0,
    )


def text_block(text: str) -> SimpleNamespace:
    return SimpleNamespace(type="text", text=text)


def tool_block(name: str, arguments: dict[str, Any], block_id: str = "toolu_1") -> SimpleNamespace:
    return SimpleNamespace(type="tool_use", id=block_id, name=name, input=arguments)


def reply(content: list[SimpleNamespace], stop_reason: str = "end_turn", **tokens: int) -> SimpleNamespace:
    return SimpleNamespace(
        content=content, usage=usage(**tokens), stop_reason=stop_reason, model="claude-haiku-5-5"
    )


class FakeStream:
    def __init__(self, final: SimpleNamespace) -> None:
        self.final = final

    def __iter__(self) -> Iterator[SimpleNamespace]:
        for block in self.final.content:
            if block.type == "text":
                for piece in (block.text[: len(block.text) // 2], block.text[len(block.text) // 2 :]):
                    yield SimpleNamespace(
                        type="content_block_delta", delta=SimpleNamespace(type="text_delta", text=piece)
                    )

    def get_final_message(self) -> SimpleNamespace:
        return self.final


class FakeBatches:
    def __init__(self) -> None:
        self.created: list[dict[str, Any]] = []
        self.status = "in_progress"
        self.result: SimpleNamespace | None = None

    def create(self, requests: list[dict[str, Any]]) -> SimpleNamespace:
        self.created.append({"requests": requests})
        return SimpleNamespace(id="msgbatch_test", processing_status="in_progress")

    def retrieve(self, batch_id: str) -> SimpleNamespace:
        return SimpleNamespace(id=batch_id, processing_status=self.status)

    def results(self, batch_id: str) -> list[SimpleNamespace]:
        assert self.result is not None
        return [self.result]


class FakeMessages:
    def __init__(self) -> None:
        self.scripted: list[SimpleNamespace] = []
        self.requests: list[dict[str, Any]] = []
        self.batches = FakeBatches()

    def create(self, **params: Any) -> SimpleNamespace:
        self.requests.append(params)
        return self.scripted.pop(0)

    @contextmanager
    def stream(self, **params: Any) -> Iterator[FakeStream]:
        self.requests.append(params)
        yield FakeStream(self.scripted.pop(0))


class FakeApi:
    def __init__(self) -> None:
        self.messages = FakeMessages()


def fake_llm(budget: float = 5.0) -> tuple[Llm, FakeApi]:
    api = FakeApi()
    return Llm(api, "claude-haiku-5-5", budget_usd=budget), api


# --- data ---------------------------------------------------------------------------------------------


def seed(db: Session) -> tuple[int, int, int]:
    """A user with a GPS run full of things the model must not see, an older run, and a week of data."""
    user = User(
        email="runner@example.com", display_name="Raúl", location="Madrid", sex="male", weight_kg=71.5
    )
    db.add(user)
    db.flush()
    db.add(UserSettings(user_id=user.id, theme="system", units="metric", language="es"))
    run = Activity(
        user_id=user.id,
        source="garmin",
        external_id="1",
        name="Madrid Running",
        description="Along the river with Ana",
        sport="run",
        sub_sport="generic",
        start_utc=RUN_START,
        timezone="+01:00",
        duration_s=3600,
        moving_s=3500,
        distance_m=10000,
        ascent_m=80,
        descent_m=75,
        avg_hr=150,
        max_hr=172,
        calories=700,
        training_effect=3.2,
        device="Forerunner 965",
        has_gps=True,
        bbox=[40.4, -3.7, 40.5, -3.6],
        route_simplified="_p~iF~ps|U_ulLnnqC",
        splits=[{"distance_m": 1000, "time_s": 350, "elevation_change_m": 2, "avg_hr": 148}] * 10,
        raw_meta={"locationName": "Madrid", "lat": 40.41},
    )
    older = Activity(
        user_id=user.id,
        source="file",
        external_id="2",
        name="Easy jog",
        sport="run",
        start_utc=RUN_START - timedelta(days=30),
        timezone="+01:00",
        duration_s=2400,
        moving_s=2400,
        distance_m=6000,
        avg_hr=140,
        has_gps=False,
    )
    db.add_all([run, older])
    db.flush()
    db.add_all(
        [
            ActivityMetrics(
                activity_id=run.id,
                user_id=user.id,
                metrics_version=2,
                trimp=120.5,
                hr_zones=[0, 600, 2400, 500, 0],
            ),
            ActivityMetrics(activity_id=older.id, user_id=user.id, metrics_version=2, trimp=60),
            BestEffort(
                activity_id=run.id,
                distance_key="5k",
                user_id=user.id,
                distance_m=5000,
                time_s=1700,
                start_s=0,
                start_distance_m=0,
            ),
            Event(
                user_id=user.id,
                kind="record",
                payload={"activity_id": run.id, "distance_key": "5k", "time_s": 1700},
                dedupe_key=f"record:{run.id}:5k",
            ),
            EstimateRow(
                user_id=user.id,
                kind="vdot",
                day=MONDAY + timedelta(days=2),
                value=48.2,
                method="riegel",
                metrics_version=2,
            ),
            SleepSession(
                user_id=user.id,
                source="garmin",
                external_id="s1",
                day=MONDAY + timedelta(days=2),
                start_utc=datetime(2026, 11, 3, 22, 0, tzinfo=UTC),
                end_utc=datetime(2026, 11, 4, 6, 0, tzinfo=UTC),
                asleep_s=27000,
                score=82,
            ),
            DailyHealth(
                user_id=user.id,
                source="garmin",
                external_id="h1",
                day=MONDAY + timedelta(days=2),
                resting_hr=48,
                hrv_ms=62,
            ),
        ]
    )
    for n in range(7):
        day = MONDAY + timedelta(days=n)
        db.add(
            DailyLoad(
                user_id=user.id,
                day=day,
                load=120.5 if n == 2 else 0,
                ctl=40 + n * 0.5,
                atl=50 - n,
                tsb=-10 + n,
            )
        )
    return user.id, run.id, older.id


@pytest.fixture
def world(database: str) -> Iterator[tuple[sessionmaker[Session], int, int, int]]:
    engine = create_engine(database)
    sessions = sessionmaker(engine, expire_on_commit=False)
    with sessions.begin() as db:
        ids = seed(db)
    yield (sessions, *ids)
    engine.dispose()


@pytest.fixture
def http(
    world: tuple[sessionmaker[Session], int, int, int],
) -> Iterator[tuple[TestClient, sessionmaker[Session], Llm, FakeApi]]:
    sessions, user_id, _, _ = world
    engine = sessions.kw["bind"]
    llm, api = fake_llm()
    token, digest = new_token()
    with sessions.begin() as db:
        db.add(
            Device(
                user_id=user_id,
                name="Browser",
                platform="web",
                refresh_token_hash=digest,
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )

    def session() -> Iterator[Session]:
        with sessions() as db:
            yield db

    app = create_app(SETTINGS)
    app.dependency_overrides[get_session] = session
    app.dependency_overrides[get_settings] = lambda: SETTINGS
    app.dependency_overrides[get_engine] = lambda: engine
    app.dependency_overrides[get_llm] = lambda: llm
    client = TestClient(app)
    client.cookies.set(SESSION_COOKIE, token)
    yield client, sessions, llm, api


# --- OS-702: data minimisation ------------------------------------------------------------------------


def test_the_context_has_only_numbers_and_sports(world: tuple[sessionmaker[Session], int, int, int]) -> None:
    sessions, user_id, run_id, _ = world
    with sessions() as db:
        run = db.get_one(Activity, run_id)
        context = activity_context(db, run)
        week = weekly_context(db, user_id, MONDAY)
    for payload in (context, week):
        serialised = json.dumps(payload)
        for secret in ("Madrid", "Ana", "Forerunner", "40.4", "-3.7", "_p~iF", "Raúl", "runner@", "71.5"):
            assert secret not in serialised, f"{secret!r} reached the model"
    assert context["distance_m"] == 10000 and context["avg_hr"] == 150 and context["weekday"] == "Wednesday"
    assert context["start_hour"] == 8  # 07:30 UTC at +01:00
    assert context["metrics"]["relative_effort"] == 120.5 and context["records_set"] == [
        {"distance": "5k", "time_s": 1700}
    ]
    assert context["usual"]["count"] == 1 and context["usual"]["median_distance_m"] == 6000
    assert context["form_that_day"] == {"fitness": 41.0, "fatigue": 48.0, "form": -8.0}
    assert week["totals"] == {
        "count": 1,
        "distance_m": 10000,
        "moving_s": 3500,
        "ascent_m": 80,
        "relative_effort": 120.5,
    }
    assert week["by_sport"]["run"]["count"] == 1 and len(week["previous_weeks"]) == 11
    assert week["records_set"][0]["distance"] == "5k" and week["estimates"]["vdot"]["changed_this_week"]
    assert week["health"] == {
        "nights": 1,
        "avg_sleep_s": 27000,
        "avg_sleep_score": 82,
        "avg_hrv_ms": 62.0,
        "avg_resting_hr": 48.0,
        "avg_readiness": week["health"]["avg_readiness"],
    }


def test_anything_forbidden_is_refused() -> None:
    assert_minimised({"distance_m": 10, "items": [{"sport": "run"}]})
    for key in ("lat", "route", "name", "device", "weight_kg"):
        assert key in FORBIDDEN_KEYS
        with pytest.raises(ValueError, match=key):
            assert_minimised({"items": [{"ok": 1}, {key: "x"}]})


# --- OS-705 tools -------------------------------------------------------------------------------------


def test_the_tools_answer_from_minimised_data(world: tuple[sessionmaker[Session], int, int, int]) -> None:
    sessions, user_id, run_id, older_id = world
    assert [t["name"] for t in tool_specs()] == [
        "search_activities",
        "activity_details",
        "fitness_stats",
        "records",
        "daily_health",
        "estimates",
    ]
    assert all(spec["input_schema"]["additionalProperties"] is False for spec in tool_specs())
    with sessions() as db:
        found = run_tool(
            db, user_id, "search_activities", {"sport": "run", "from": "2026-10-01", "to": "2026-11-09"}
        )
        assert [i["activity_id"] for i in found["items"]] == [run_id, older_id]
        assert found["items"][0]["link"] == f"/activities/{run_id}" and "name" not in found["items"][0]
        assert found["totals"]["distance_m"] == 16000
        by_distance = run_tool(
            db, user_id, "search_activities", {"sort": "distance", "limit": 1, "from": "2026-09-01"}
        )
        assert by_distance["items"][0]["activity_id"] == run_id and by_distance["truncated"]
        fitness = run_tool(db, user_id, "fitness_stats", {"from": "2026-11-02", "to": "2026-11-09"})
        assert fitness["today"]["day"] == "2026-11-08" and fitness["weeks"][0]["relative_effort"] == 120.5
        best = run_tool(db, user_id, "records", {})
        assert best["all_time"][0]["distance"] == "5k" and best["all_time"][0]["pace_s_per_km"] == 340.0
        health = run_tool(db, user_id, "daily_health", {"from": "2026-11-02", "to": "2026-11-09"})
        assert health["days"][0]["hrv_ms"] == 62.0 and health["days"][0]["asleep_s"] == 27000
        assert run_tool(db, user_id, "estimates", {})["estimates"][0]["kind"] == "vdot"
        details = run_tool(db, user_id, "activity_details", {"activity_id": run_id})
        assert details["splits"][0]["time_s"] == 350 and "name" not in json.dumps(details)
        with pytest.raises(ToolError, match="no activity"):
            run_tool(db, user_id + 1, "activity_details", {"activity_id": run_id})
        with pytest.raises(ToolError, match="limit"):
            run_tool(db, user_id, "search_activities", {"limit": 500})
        with pytest.raises(ToolError, match="unknown tool"):
            run_tool(db, user_id, "delete_everything", {})


# --- OS-701, OS-706: the client, its cost and the budget ----------------------------------------------


def test_cost_follows_the_price_list() -> None:
    use = Usage.of(usage(1_000_000, 100_000, cache_read=500_000))
    assert use.cache_read_tokens == 500_000
    assert cost_usd("claude-haiku-5-5", use) == pytest.approx(0.10 + 0.05 + 0.005)
    assert cost_usd("claude-haiku-5-5", use, batch=True) == pytest.approx((0.10 + 0.05 + 0.005) / 2)
    assert cost_usd("unknown-model", Usage(1_000_000, 0)) == 4.0  # priced as the dearest known model
    assert Usage.of(None) == Usage()


def test_a_summary_is_written_recorded_and_served(
    http: tuple[TestClient, sessionmaker[Session], Llm, FakeApi],
) -> None:
    client, sessions, _llm, api = http
    with sessions() as db:
        run_id = db.scalar(select(Activity.id).where(Activity.external_id == "1"))
    assert client.get(f"/api/activities/{run_id}/summary").status_code == 404
    api.messages.scripted.append(
        reply(
            [
                text_block(
                    json.dumps(
                        {
                            "suggested_title": "Rodaje de 10 km con récord",
                            "summary": "Diez kilómetros a 5:50 min/km.",
                            "highlights": ["Récord en 5 km", ""],
                        }
                    )
                )
            ]
        )
    )
    created = client.post(f"/api/activities/{run_id}/summary")
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["suggested_title"] == "Rodaje de 10 km con récord" and body["highlights"] == [
        "Récord en 5 km"
    ]
    assert body["language"] == "es" and body["model"] == "claude-haiku-5-5"
    assert (
        client.get(f"/api/activities/{run_id}/summary").json()["summary"] == "Diez kilómetros a 5:50 min/km."
    )
    request = api.messages.requests[0]
    assert (
        request["model"] == "claude-haiku-5-5" and request["output_config"]["format"]["type"] == "json_schema"
    )
    assert request["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert (
        "Language: Spanish" in request["messages"][0]["content"]
        and "Madrid" not in request["messages"][0]["content"]
    )
    with sessions() as db:
        call = db.scalar(select(LlmCall))
        assert call is not None and call.purpose == "summary" and call.input_tokens == 3000
        assert call.cost_usd == pytest.approx((3000 * 0.10 + 300 * 0.50) / 1_000_000)
    status = client.get("/api/ai/status").json()
    assert status["available"] and status["enabled"] and status["model"] == "claude-haiku-5-5"
    assert status["budget"]["month_cost_usd"] == pytest.approx(call.cost_usd, abs=1e-4)
    assert not status["budget"]["warning"] and status["never_sends"]


def test_the_monthly_budget_stops_the_model(
    http: tuple[TestClient, sessionmaker[Session], Llm, FakeApi],
) -> None:
    client, sessions, llm, api = http
    with sessions.begin() as db:
        user_id = db.scalar(select(User.id))
        run_id = db.scalar(select(Activity.id).where(Activity.external_id == "1"))
        db.add(
            LlmCall(
                user_id=user_id, purpose="coach", model="x", input_tokens=1, output_tokens=1, cost_usd=5.0
            )
        )
    status = client.get("/api/ai/status").json()["budget"]
    assert status["exceeded"] and status["warning"]
    assert client.post(f"/api/activities/{run_id}/summary").status_code == 409
    assert api.messages.requests == []
    with sessions() as db, pytest.raises(LlmBudgetExceeded):
        llm.check_budget(db, user_id)


def test_without_a_key_or_with_the_switch_off_everything_is_hidden(
    http: tuple[TestClient, sessionmaker[Session], Llm, FakeApi],
) -> None:
    client, sessions, _llm, _api = http
    with sessions() as db:
        run_id = db.scalar(select(Activity.id).where(Activity.external_id == "1"))
    assert client.patch(
        "/api/settings", json={"ai": {"enabled": False, "summaries": True, "weekly": True}}
    ).json()["ai"] == {
        "enabled": False,
        "summaries": True,
        "weekly": True,
    }
    assert client.post(f"/api/activities/{run_id}/summary").status_code == 409
    assert (
        client.post("/api/ai/coach", json={"messages": [{"role": "user", "content": "hola"}]}).status_code
        == 409
    )
    with sessions() as db:
        user_id = db.scalar(select(User.id))
        assert ai_preferences(db, user_id) == {"enabled": False, "summaries": True, "weekly": True}
    client.app.dependency_overrides[get_llm] = lambda: None  # type: ignore[attr-defined]
    status = client.get("/api/ai/status").json()
    assert status == {**status, "available": False, "model": None, "budget": None}


# --- OS-703: on import ----------------------------------------------------------------------------------


def test_a_recent_activity_is_queued_for_a_summary(
    world: tuple[sessionmaker[Session], int, int, int], monkeypatch: pytest.MonkeyPatch
) -> None:
    sessions, _user, run_id, older_id = world
    monkeypatch.setattr("zankup.core.config.get_settings", lambda: SETTINGS)
    with sessions.begin() as db:
        run = db.get_one(Activity, run_id)
        run.start_utc = datetime.now(UTC) - timedelta(hours=3)
        assert maybe_queue_summary(db, run)
        assert not maybe_queue_summary(db, run)  # the same activity once
        assert not maybe_queue_summary(db, db.get_one(Activity, older_id))  # a backfill is not summarised
        job = db.scalar(select(Job).where(Job.kind == "ai_summary"))
        assert job is not None and job.payload == {"activity_id": run_id}
    monkeypatch.setattr("zankup.core.config.get_settings", lambda: NO_AI)
    with sessions.begin() as db:
        run = db.get_one(Activity, run_id)
        run.external_id = "3"
        assert not maybe_queue_summary(db, run)
    llm, api = fake_llm()
    api.messages.scripted.append(
        reply([text_block('{"suggested_title": "T", "summary": "S", "highlights": []}')])
    )
    with sessions.begin() as db:
        row = generate_summary(db, llm, db.get_one(Activity, run_id))
        assert row.summary == "S" and db.get(ActivitySummary, run_id) is row


# --- OS-704: the weekly report ------------------------------------------------------------------------


def test_the_weekly_report_goes_through_the_batch_api(
    world: tuple[sessionmaker[Session], int, int, int],
) -> None:
    sessions, user_id, _, _ = world
    llm, api = fake_llm()
    assert last_week_start(date(2026, 11, 9)) == MONDAY and last_week_start(date(2026, 11, 12)) == MONDAY
    with sessions.begin() as db:
        db.add(Device(user_id=user_id, name="Phone", platform="android", push_endpoint="fcm-token"))
        monday = datetime(2026, 11, 9, 5, 0, tzinfo=UTC)
        assert queue_weekly(db, user_id, monday - timedelta(days=1), hour=6) is None  # Sunday
        job_id = queue_weekly(db, user_id, monday, hour=6)
        assert job_id is not None and queue_weekly(db, user_id, monday + timedelta(hours=1), hour=6) is None
        job = db.get_one(Job, job_id)
        assert job.payload == {"week_start": "2026-11-02"} and job.run_after == monday.replace(hour=6)
    with sessions.begin() as db:
        weekly_handler(llm)(db, db.get_one(Job, job_id))
        report = db.scalar(select(WeeklyReport))
        assert report is not None and report.status == "pending" and report.batch_id == "msgbatch_test"
        assert (
            report.language == "es"
            and report.context is not None
            and "Madrid" not in json.dumps(report.context)
        )
        sent = api.messages.batches.created[0]["requests"][0]
        assert (
            sent["custom_id"] == f"weekly-{report.id}"
            and sent["params"]["output_config"]["format"]["type"] == "json_schema"
        )
        poll = db.scalar(select(Job).where(Job.kind == "ai_weekly_poll"))
        assert poll is not None and poll.payload == {"report_id": report.id}
        report_id, poll_id = report.id, poll.id
    with sessions.begin() as db:  # still processing: come back later
        weekly_poll_handler(llm)(db, db.get_one(Job, poll_id))
        assert db.get_one(WeeklyReport, report_id).status == "pending"
        assert db.scalar(select(Job).where(Job.kind == "ai_weekly_poll", Job.id != poll_id)) is not None
    api.messages.batches.status = "ended"
    api.messages.batches.result = SimpleNamespace(
        custom_id=f"weekly-{report_id}",
        result=SimpleNamespace(
            type="succeeded",
            message=reply(
                [
                    text_block(
                        json.dumps(
                            {
                                "headline": "Semana sólida",
                                "summary": "10 km.",
                                "recommendation": "Descansa.",
                                "highlights": ["Récord 5 km"],
                            }
                        )
                    )
                ],
                input_tokens=4000,
                output_tokens=400,
            ),
        ),
    )
    with sessions.begin() as db:
        weekly_poll_handler(llm)(db, db.get_one(Job, poll_id))
        report = db.get_one(WeeklyReport, report_id)
        assert (
            report.status == "done"
            and report.headline == "Semana sólida"
            and report.highlights == ["Récord 5 km"]
        )
        call = db.scalar(select(LlmCall).where(LlmCall.purpose == "weekly"))
        assert (
            call is not None
            and call.batch
            and call.cost_usd == pytest.approx((4000 * 0.10 + 400 * 0.50) / 2_000_000)
        )
        push = db.scalar(select(Job).where(Job.kind == "push"))
        assert (
            push is not None
            and push.payload["kind"] == "weekly"
            and push.payload["data"]["headline"] == "Semana sólida"
        )
    assert message("weekly", {"headline": "Semana sólida"}, "es") == {
        "title": "Tu informe semanal",
        "body": "Semana sólida",
        "url": "/coach",
        "tag": "weekly",
    }


def test_the_scheduler_queues_the_report_on_mondays(
    world: tuple[sessionmaker[Session], int, int, int],
) -> None:
    sessions, _user, _, _ = world
    scheduler = Scheduler(sessions, interval=None, owner_email="runner@example.com", weekly_hour=6)
    scheduler.tick(datetime(2026, 11, 10, 9, 0, tzinfo=UTC))  # Tuesday
    with sessions() as db:
        assert db.scalar(select(Job).where(Job.kind == "ai_weekly")) is None
    scheduler.tick(datetime(2026, 11, 9, 9, 0, tzinfo=UTC))  # Monday, after the hour: due now
    with sessions() as db:
        job = db.scalar(select(Job).where(Job.kind == "ai_weekly"))
        assert job is not None and job.payload == {"week_start": "2026-11-02"}


def test_the_report_can_be_asked_for_now(
    http: tuple[TestClient, sessionmaker[Session], Llm, FakeApi],
) -> None:
    client, _sessions, _llm, api = http
    api.messages.scripted.append(
        reply(
            [
                text_block(
                    json.dumps(
                        {"headline": "Good week", "summary": "S", "recommendation": "R", "highlights": []}
                    )
                )
            ]
        )
    )
    assert client.post("/api/ai/weekly", json={"week_start": "2026-11-03"}).status_code == 422  # a Tuesday
    created = client.post("/api/ai/weekly", json={"week_start": "2026-11-02"})
    assert created.status_code == 200, created.text
    assert created.json()["status"] == "done" and created.json()["headline"] == "Good week"
    listed = client.get("/api/ai/weekly").json()
    assert [r["week_start"] for r in listed] == ["2026-11-02"]


# --- OS-705: the Coach --------------------------------------------------------------------------------


def test_the_coach_streams_and_quotes_the_tools(
    http: tuple[TestClient, sessionmaker[Session], Llm, FakeApi],
) -> None:
    client, sessions, _llm, api = http
    api.messages.scripted.append(
        reply([tool_block("search_activities", {"sport": "run", "from": "2026-10-01"})], "tool_use")
    )
    api.messages.scripted.append(
        reply([text_block("Has corrido 16.0 km en dos salidas: /activities/1.")], cache_read=1200)
    )
    response = client.post(
        "/api/ai/coach", json={"messages": [{"role": "user", "content": "¿Cuánto he corrido este mes?"}]}
    )
    assert response.status_code == 200 and response.headers["content-type"].startswith("application/x-ndjson")
    events = [json.loads(line) for line in response.text.splitlines()]
    assert [e["type"] for e in events] == ["tool", "tool", "text", "text", "done"]
    assert events[0] == {"type": "tool", "name": "search_activities", "status": "running"}
    assert (
        "".join(e["text"] for e in events if e["type"] == "text")
        == "Has corrido 16.0 km en dos salidas: /activities/1."
    )
    assert events[-1]["tools"] == ["search_activities"] and events[-1]["usage"]["cache_read_tokens"] == 1200
    first, second = api.messages.requests
    assert [t["name"] for t in first["tools"]] == [t["name"] for t in tool_specs()]
    assert "Answer in Spanish" in first["messages"][0]["content"] and first["output_config"] == {
        "effort": "medium"
    }
    tool_result = second["messages"][-1]["content"][0]
    assert tool_result["type"] == "tool_result" and tool_result["tool_use_id"] == "toolu_1"
    assert "Madrid" not in tool_result["content"] and '"distance_m":10000' in tool_result["content"]
    with sessions() as db:
        assert [c.purpose for c in db.scalars(select(LlmCall))] == ["coach", "coach"]


def test_a_failing_tool_is_reported_to_the_model(world: tuple[sessionmaker[Session], int, int, int]) -> None:
    sessions, user_id, _, _ = world
    llm, api = fake_llm()
    api.messages.scripted.append(
        reply([tool_block("activity_details", {"activity_id": 999_999})], "tool_use")
    )
    api.messages.scripted.append(reply([text_block("No encuentro esa actividad.")]))
    with sessions() as db:
        text, tools = answer_text(db, llm, user_id, "¿Qué tal la actividad 999999?", today="2026-11-09")
    assert text == "No encuentro esa actividad." and tools == ["activity_details"]
    result = api.messages.requests[1]["messages"][-1]["content"][0]
    assert result["is_error"] and "no activity 999999" in result["content"]


# --- OS-709: the MCP server ---------------------------------------------------------------------------


def rpc(
    client: TestClient,
    token: str | None,
    method: str,
    params: dict[str, Any] | None = None,
    request_id: int = 1,
) -> Any:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    body: dict[str, Any] = {"jsonrpc": "2.0", "method": method, "params": params or {}}
    if request_id:
        body["id"] = request_id
    return client.post("/api/mcp", json=body, headers=headers)


def test_the_mcp_server_serves_the_tools_behind_a_personal_token(
    http: tuple[TestClient, sessionmaker[Session], Llm, FakeApi],
) -> None:
    client, sessions, _llm, _api = http
    client.cookies.clear()  # the MCP server never uses the session
    assert rpc(client, None, "initialize").status_code == 401
    assert rpc(client, "zk_wrong", "tools/list").status_code == 401
    client.cookies.set(SESSION_COOKIE, _session_token(sessions))
    created = client.post("/api/ai/tokens", json={"name": "Claude Desktop"})
    assert created.status_code == 201, created.text
    token = created.json()["token"]
    assert (
        token.startswith("zk_")
        and created.json()["prefix"] == token[:8]
        and created.json()["url"] == "/api/mcp"
    )
    listed = client.get("/api/ai/tokens").json()
    assert [t["name"] for t in listed] == ["Claude Desktop"] and "token" not in listed[0]
    client.cookies.clear()
    init = rpc(client, token, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}}).json()
    assert "result" in init, init
    assert (
        init["result"]["protocolVersion"] == "2025-06-18" and init["result"]["serverInfo"]["name"] == "zankup"
    )
    assert rpc(client, token, "notifications/initialized", request_id=0).status_code == 202
    tools = rpc(client, token, "tools/list").json()["result"]["tools"]
    assert [t["name"] for t in tools] == [t["name"] for t in tool_specs()]
    assert (
        tools[0]["annotations"]["readOnlyHint"] and tools[0]["inputSchema"]["additionalProperties"] is False
    )
    called = rpc(client, token, "tools/call", {"name": "records", "arguments": {}}).json()["result"]
    assert not called["isError"] and called["structuredContent"]["all_time"][0]["distance"] == "5k"
    assert json.loads(called["content"][0]["text"])["all_time"][0]["time_s"] == 1700
    bad = rpc(client, token, "tools/call", {"name": "search_activities", "arguments": {"limit": 0}}).json()[
        "result"
    ]
    assert bad["isError"] and "limit" in bad["content"][0]["text"]
    assert (
        rpc(client, token, "tools/call", {"name": "nope", "arguments": {}}).json()["error"]["code"] == -32602
    )
    assert rpc(client, token, "resources/list").json()["error"]["code"] == -32601
    assert client.get("/api/mcp", headers={"Authorization": f"Bearer {token}"}).status_code == 405
    with sessions() as db:
        used = db.scalar(select(User)) and db.scalar(select(Device.id).where(Device.platform == "web"))
        assert used is not None
    client.cookies.set(SESSION_COOKIE, _session_token(sessions))
    assert client.delete(f"/api/ai/tokens/{created.json()['id']}").status_code == 204
    assert client.get("/api/ai/tokens").json() == []
    client.cookies.clear()
    assert rpc(client, token, "tools/list").status_code == 401


def _session_token(sessions: sessionmaker[Session]) -> str:
    token, digest = new_token()
    with sessions.begin() as db:
        user_id = db.scalar(select(User.id))
        db.add(
            Device(
                user_id=user_id,
                name="Second browser",
                platform="web",
                refresh_token_hash=digest,
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
    return token


# --- OS-707: the evaluation's grounding check ---------------------------------------------------------


def test_the_evaluation_spots_invented_numbers() -> None:
    from zankup.ai.eval import grounded, load_cases, numbers_in

    data = {"items": [{"distance_m": 10000, "moving_s": 3500, "day": "2026-11-04"}], "totals": {"count": 2}}
    assert numbers_in("Ran 10.0 km in 58:20 on 2026-11-04, 2 runs (/activities/77)") == [
        10.0,
        58,
        20,
        2026,
        11,
        4,
        2,
    ]
    assert grounded("You ran 10.0 km in 58 minutes on 4 November 2026.", data) == []
    assert grounded("You ran 42.2 km and climbed 1500 m.", data) == [42.2, 1500.0]
    cases = load_cases()
    assert len(cases) == 46 and {c.language for c in cases} == {"en", "es"}
    assert all(c.question for c in cases if c.kind == "coach")


def test_structured_output_schemas_use_only_what_the_api_accepts() -> None:
    """Structured outputs reject length and count limits: a schema with them failed every summary (400)."""
    from zankup.ai import summary, weekly

    unsupported = {"maxItems", "minLength", "maxLength", "minimum", "maximum", "pattern"}

    def keys(node: object) -> set[str]:
        if isinstance(node, dict):
            return set(node) | {k for v in node.values() for k in keys(v)}
        if isinstance(node, list):
            return {k for v in node for k in keys(v)}
        return set()

    for schema in (summary.SCHEMA, weekly.SCHEMA):
        assert not keys(schema) & unsupported


def test_a_stray_space_around_the_model_is_trimmed(monkeypatch: pytest.MonkeyPatch) -> None:
    from zankup.core.config import Settings

    monkeypatch.setenv("AI_MODEL", " claude-haiku-5-5 ")
    assert Settings().ai_model == "claude-haiku-5-5"
