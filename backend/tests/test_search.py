"""Advanced search (OS-219): filters in any combination, accent-insensitive text, sorting, totals."""

import time
from datetime import UTC, datetime, timedelta

from sqlalchemy import insert, update

from tests.test_activities import Ctx, ctx  # noqa: F401 - three imported FITs and a signed-in client
from zankup.db.models import Activity


def ids(ctx: Ctx, **params: object) -> list[int]:  # noqa: F811
    response = ctx.http.get("/api/activities/search", params=params)
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()["items"]]


def test_text_is_accent_and_case_insensitive(ctx: Ctx) -> None:  # noqa: F811
    with ctx.sessions.begin() as db:
        db.execute(
            update(Activity)
            .where(Activity.id == ctx.ids["run"])
            .values(name="Carrera matutina por el Retiro", description="Series en la pista")
        )
    assert ids(ctx, q="matutína") == [ctx.ids["run"]]
    assert ids(ctx, q="RETIRO carr") == [ctx.ids["run"]]  # every word, as a prefix
    assert ids(ctx, q="pista") == [ctx.ids["run"]]  # the description too
    assert ids(ctx, q="nothing like this") == []


def test_filters_combine_and_totals_cover_every_match(ctx: Ctx) -> None:  # noqa: F811
    run, ride = ctx.ids["run"], ctx.ids["ride-power"]
    assert set(ids(ctx, sport=["run", "ride"])) == {run, ride}
    assert run in ids(ctx, with_gps=True) and ctx.ids["strength"] not in ids(ctx, with_gps=True)
    page = ctx.http.get("/api/activities/search", params={"sport": ["run", "ride"], "limit": 1}).json()
    assert len(page["items"]) == 1 and page["next_offset"] == 1
    assert page["totals"]["count"] == 2 and page["totals"]["distance_m"] > 0
    second = ctx.http.get(
        "/api/activities/search", params={"sport": ["run", "ride"], "limit": 1, "offset": 1}
    ).json()
    assert second["next_offset"] is None and second["items"][0]["id"] != page["items"][0]["id"]
    assert ids(ctx, min_distance=1, max_distance=1) == []
    assert ids(ctx, with_description=True) == []
    assert ids(ctx, source=["strava"]) == []
    assert ctx.http.get("/api/activities/search", params={"sort": "nonsense"}).status_code == 422


def test_sorting(ctx: Ctx) -> None:  # noqa: F811
    by_distance = ids(ctx, sort="distance", order="asc", min_distance=1)
    assert len(by_distance) == 2
    longest = ids(ctx, sort="distance", order="desc", min_distance=1)
    assert longest == list(reversed(by_distance))
    assert ids(ctx, sort="duration")[0] in ctx.ids.values()


def test_records_filter(ctx: Ctx) -> None:  # noqa: F811
    with_record = ids(ctx, with_record=True)
    assert ctx.ids["run"] in with_record  # its best efforts are the only ones, so all-time bests


def test_fast_over_a_long_history(ctx: Ctx) -> None:  # noqa: F811
    start = datetime(2015, 1, 1, tzinfo=UTC)
    with ctx.sessions.begin() as db:
        user_id = db.get_one(Activity, ctx.ids["run"]).user_id
        db.execute(
            insert(Activity),
            [
                {
                    "user_id": user_id,
                    "source": "garmin",
                    "external_id": f"bulk-{i}",
                    "sport": ("run", "ride", "walk")[i % 3],
                    "name": f"Rodaje {i} por la sierra" if i % 2 else f"Morning ride {i}",
                    "start_utc": start + timedelta(days=i * 1.7),
                    "duration_s": 1800 + i,
                    "moving_s": 1700 + i,
                    "distance_m": 5000 + (i % 40) * 500,
                    "ascent_m": i % 300,
                    "avg_hr": 120 + i % 50,
                    "has_gps": True,
                }
                for i in range(1800)
            ],
        )
    params = {
        "q": "sierra",
        "sport": ["run", "walk"],
        "from": "2016-01-01T00:00:00Z",
        "min_distance": 8000,
        "min_ascent": 50,
        "min_hr": 130,
        "with_gps": True,
        "sort": "speed",
    }
    ctx.http.get("/api/activities/search", params=params)  # warm up
    began = time.perf_counter()
    response = ctx.http.get("/api/activities/search", params=params)
    elapsed = time.perf_counter() - began
    assert response.status_code == 200 and response.json()["totals"]["count"] > 0
    assert elapsed < 0.2, f"{elapsed * 1000:.0f} ms"
