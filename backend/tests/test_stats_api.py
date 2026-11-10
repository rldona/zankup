"""The phase 3 API over what the engine computed for the three anonymised FITs."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update

from tests.test_activities import Ctx, ctx  # noqa: F401 - three imported FITs and a signed-in client
from tests.test_engine import drain, recent
from zankup.db.models import Activity, Job


def ready(context: Ctx) -> None:
    recent(context)
    drain(context)


def test_fitness_summary_and_volume(ctx: Ctx) -> None:  # noqa: F811
    ready(ctx)
    fitness = ctx.http.get("/api/stats/fitness").json()
    assert fitness and fitness[-1]["ctl"] > 0
    summary = ctx.http.get("/api/stats/summary").json()
    assert summary["current"]["count"] == 3 and summary["previous"]["count"] == 0
    assert set(summary["by_sport"]) == {"run", "strength", "ride"}
    today = datetime.now(UTC).date()
    weeks = ctx.http.get(
        "/api/stats/volume", params={"from": (today - timedelta(days=28)).isoformat(), "unit": "week"}
    ).json()
    assert len(weeks) >= 4 and sum(w["totals"]["count"] for w in weeks) == 3  # no holes, nothing lost


def test_curves_records_and_estimates(ctx: Ctx) -> None:  # noqa: F811
    ready(ctx)
    power = ctx.http.get("/api/stats/curves", params={"kind": "power"}).json()
    assert power[0]["duration_s"] == 5 and power[0]["activity_id"] == ctx.ids["ride-power"]
    speed = ctx.http.get("/api/stats/curves", params={"kind": "speed", "sport": "run"}).json()
    assert speed and all(p["activity_id"] == ctx.ids["run"] for p in speed)
    records = ctx.http.get("/api/stats/records").json()
    assert records["all_time"] and records["progression"]
    estimates = {e["kind"]: e for e in ctx.http.get("/api/stats/estimates").json()}
    assert "hr_max" in estimates and estimates["hr_max"]["sources"]
    assert estimates["hr_max"]["history"]


def test_progress_calendar_heatmap_and_efficiency(ctx: Ctx) -> None:  # noqa: F811
    ready(ctx)
    lines = ctx.http.get("/api/stats/progress", params={"years": 2}).json()
    assert len(lines) == 2 and lines[-1]["cumulative_m"][-1] > 0
    today = datetime.now(UTC).date()
    days = ctx.http.get(
        "/api/stats/calendar",
        params={
            "from": (today - timedelta(days=7)).isoformat(),
            "to": (today + timedelta(days=1)).isoformat(),
        },
    ).json()
    assert len(days) == 8 and sum(len(d["activities"]) for d in days) == 3
    assert ctx.http.get("/api/stats/heatmap").json()["routes"]
    assert ctx.http.get("/api/stats/years").json()[0] == today.year
    assert isinstance(ctx.http.get("/api/stats/efficiency").json(), list)


def test_detail_shows_the_engines_metrics(ctx: Ctx) -> None:  # noqa: F811
    ready(ctx)
    detail = ctx.http.get(f"/api/activities/{ctx.ids['run']}").json()
    metrics = detail["metrics"]
    assert metrics["trimp"] > 0 and len(metrics["hr_zone_bounds"]) == 5 and sum(metrics["hr_zones"]) > 0
    assert metrics["gap_speed"] > 0 and metrics["speed_curve"]
    ride = ctx.http.get(f"/api/activities/{ctx.ids['ride-power']}").json()
    assert ride["metrics"]["power_curve"][0]["duration_s"] == 5


def test_segments_routes_goals_events_and_engine(ctx: Ctx) -> None:  # noqa: F811
    ready(ctx)
    created = ctx.http.post(
        "/api/segments",
        json={"activity_id": ctx.ids["run"], "start_index": 300, "end_index": 900, "name": "Hill"},
    )
    assert created.status_code == 201, created.text
    segment = created.json()
    drain(ctx)
    detail = ctx.http.get(f"/api/segments/{segment['id']}").json()
    assert detail["efforts"] == 1 and detail["history"][0]["activity_id"] == ctx.ids["run"]
    activity = ctx.http.get(f"/api/activities/{ctx.ids['run']}").json()
    assert activity["segments"][0]["name"] == "Hill" and activity["segments"][0]["rank"] == 1
    assert (
        ctx.http.post(
            "/api/segments",
            json={"activity_id": ctx.ids["strength"], "start_index": 0, "end_index": 50, "name": "x"},
        ).status_code
        == 422
    )
    assert ctx.http.delete(f"/api/segments/{segment['id']}").status_code == 204

    assert ctx.http.get("/api/routes").json() == []  # nothing done twice yet

    goal = ctx.http.post(
        "/api/goals", json={"period": "year", "metric": "distance", "target": 1_000_000}
    ).json()
    assert goal["current"] > 0 and goal["projection"] >= goal["current"]
    assert [g["id"] for g in ctx.http.get("/api/goals").json()] == [goal["id"]]
    changed = ctx.http.patch(
        f"/api/goals/{goal['id']}",
        json={"period": "week", "metric": "time", "sport": "strength", "target": 7200},
    ).json()
    assert (changed["id"], changed["period"], changed["metric"], changed["sport"], changed["target"]) == (
        goal["id"],
        "week",
        "time",
        "strength",
        7200,
    )
    assert (
        ctx.http.patch(
            "/api/goals/999999", json={"period": "week", "metric": "time", "target": 1}
        ).status_code
        == 404
    )
    assert ctx.http.delete(f"/api/goals/{goal['id']}").status_code == 204
    assert (
        ctx.http.post("/api/goals", json={"period": "day", "metric": "distance", "target": 1}).status_code
        == 422
    )

    assert isinstance(ctx.http.get("/api/events").json(), list)
    status = ctx.http.get("/api/engine").json()
    assert status["computed"] == status["activities"] == 3 and not status["running"]
    assert ctx.http.post("/api/engine/recompute").status_code == 202


def test_changing_heart_rate_settings_recomputes(ctx: Ctx) -> None:  # noqa: F811
    ready(ctx)
    ctx.http.patch("/api/settings", json={"hr_max": 185, "zone_model": "reserve", "hr_rest": 50})
    with ctx.sessions() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(Job)
                .where(Job.kind == "metrics_full", Job.status == "queued")
            )
            == 1
        )
    drain(ctx)
    bounds = ctx.http.get(f"/api/activities/{ctx.ids['run']}").json()["metrics"]["hr_zone_bounds"]
    assert bounds == [118, 131, 144, 158, 172]  # Karvonen with 50 and 185
    assert ctx.http.get("/api/settings").json()["zone_model"] == "reserve"
    with ctx.sessions.begin() as db:
        db.execute(update(Activity).values(name="x"))  # unrelated changes do not recompute
