"""Activities API over the anonymised fixtures: feed, detail, series and original file."""

import json
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine, update
from sqlalchemy.orm import Session, sessionmaker

from zankup.api.activities import get_store
from zankup.api.main import create_app
from zankup.auth.deps import SESSION_COOKIE
from zankup.auth.security import new_token
from zankup.core.config import Settings, get_settings
from zankup.db.models import Activity, Device, Stream, User
from zankup.db.session import get_engine, get_session
from zankup.fit.streams import decode_streams
from zankup.ingest import ingest_fit
from zankup.storage import LocalRawStore

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
GARMIN = {a["activityName"]: a for a in json.loads((FIXTURES / "garmin" / "activity-list.json").read_text())}
SETTINGS = Settings(_env_file=None, environment="test", jwt_secret=SecretStr("test-secret"), run_worker=False)  # type: ignore[call-arg]


@dataclass
class Ctx:
    http: TestClient
    sessions: sessionmaker[Session]
    store: LocalRawStore
    ids: dict[str, int]  # fixture name → activity ID
    other_id: int  # an activity of another user


def fit(name: str) -> bytes:
    return (FIXTURES / "fit" / f"{name}.fit").read_bytes()


@pytest.fixture
def ctx(database: str, tmp_path: Path) -> Iterator[Ctx]:
    engine = create_engine(database)
    sessions = sessionmaker(engine, expire_on_commit=False)
    store = LocalRawStore(tmp_path)

    def session() -> Iterator[Session]:
        with sessions() as db:
            yield db

    ids: dict[str, int] = {}
    token, digest = new_token()
    with sessions.begin() as db:
        owner, other = User(email="runner@example.com"), User(email="someone@example.com")
        db.add_all([owner, other])
        db.flush()
        names = {"run": "Running", "strength": "Strength Training", "ride-power": "Virtual Ride"}
        for name, garmin in names.items():
            meta = GARMIN[garmin]
            ids[name] = ingest_fit(
                db, store, user_id=owner.id, source="garmin", external_id=name, fit=fit(name), meta=meta
            ).activity_id
        other_id = ingest_fit(
            db, store, user_id=other.id, source="garmin", external_id="theirs", fit=fit("run")
        ).activity_id
        db.add(
            Device(
                user_id=owner.id,
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
    app.dependency_overrides[get_store] = lambda: store
    http = TestClient(app)
    http.cookies.set(SESSION_COOKIE, token)
    yield Ctx(http, sessions, store, ids, other_id)
    engine.dispose()


def test_feed_is_newest_first_and_only_mine(ctx: Ctx) -> None:
    page = ctx.http.get("/api/activities").json()
    assert {item["id"] for item in page["items"]} == set(ctx.ids.values())
    starts = [item["start_utc"] for item in page["items"]]
    assert starts == sorted(starts, reverse=True) and page["next_cursor"] is None
    run = next(item for item in page["items"] if item["id"] == ctx.ids["run"])
    assert run["sport"] == "run" and run["has_gps"] and run["route"] and run["distance_m"] > 0


def test_feed_pages_with_a_cursor(ctx: Ctx) -> None:
    seen, cursor, pages = [], None, 0
    while True:
        params: dict[str, str | int] = {"limit": 1} | ({"cursor": cursor} if cursor else {})
        page = ctx.http.get("/api/activities", params=params).json()
        seen += [item["id"] for item in page["items"]]
        pages += 1
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert pages == 3 and len(seen) == len(set(seen)) == 3


def test_feed_pages_stay_stable_when_activities_share_a_start(ctx: Ctx) -> None:
    with ctx.sessions.begin() as db:
        db.execute(update(Activity).values(start_utc=datetime(2020, 1, 6, 8, tzinfo=UTC)))
    first = ctx.http.get("/api/activities", params={"limit": 2}).json()
    rest = ctx.http.get("/api/activities", params={"limit": 2, "cursor": first["next_cursor"]}).json()
    ids = [i["id"] for i in first["items"] + rest["items"]]
    assert sorted(ids) == sorted(ctx.ids.values()) and rest["next_cursor"] is None


def test_feed_filters_by_sport(ctx: Ctx) -> None:
    only = ctx.http.get("/api/activities", params=[("sport", "run"), ("sport", "ride")]).json()["items"]
    assert {item["sport"] for item in only} == {"run", "ride"}


def test_bad_cursor_and_limit_are_rejected(ctx: Ctx) -> None:
    assert ctx.http.get("/api/activities", params={"cursor": "not-a-cursor"}).status_code == 400
    assert ctx.http.get("/api/activities", params={"limit": 0}).status_code == 422
    assert ctx.http.get("/api/activities", params={"limit": 101}).status_code == 422


def test_detail_has_laps_splits_and_best_efforts(ctx: Ctx) -> None:
    detail = ctx.http.get(f"/api/activities/{ctx.ids['run']}").json()
    assert detail["laps"] and [lap["idx"] for lap in detail["laps"]] == list(range(len(detail["laps"])))
    assert detail["splits"] and detail["splits"][0]["distance_m"] == pytest.approx(1000, abs=1)
    efforts = [e["distance_key"] for e in detail["best_efforts"]]
    assert efforts[0] == "400m" and "1k" in efforts
    assert detail["has_fit"] and "hr" in detail["streams"]["series"] and len(detail["bbox"]) == 4

    strength = ctx.http.get(f"/api/activities/{ctx.ids['strength']}").json()
    assert strength["best_efforts"] == [] and strength["route"] is None


def test_someone_elses_activity_is_not_found(ctx: Ctx) -> None:
    for suffix in ("", "/streams", "/fit"):
        assert ctx.http.get(f"/api/activities/{ctx.other_id}{suffix}").status_code == 404
    assert ctx.http.get("/api/activities/999999").status_code == 404


def test_streams_are_sent_gzipped_and_cacheable(ctx: Ctx) -> None:
    url = f"/api/activities/{ctx.ids['run']}/streams"
    response = ctx.http.get(url)  # the test client accepts gzip and decodes it
    assert response.status_code == 200 and response.headers["Content-Encoding"] == "gzip"
    streams = response.json()
    assert len(streams["t"]) == len(streams["hr"]) > 100 and "lat" in streams

    raw = ctx.http.get(url, headers={"Accept-Encoding": "identity"})  # plain JSON without gzip
    assert "Content-Encoding" not in raw.headers and raw.json() == streams

    etag = response.headers["ETag"]
    assert ctx.http.get(url, headers={"If-None-Match": etag}).status_code == 304


def test_streams_match_what_was_stored(ctx: Ctx) -> None:
    with ctx.sessions() as db:
        stream = db.get(Stream, ctx.ids["ride-power"])
        assert stream is not None
        expected = decode_streams(stream.data)
    assert ctx.http.get(f"/api/activities/{ctx.ids['ride-power']}/streams").json() == expected


def test_fit_is_the_original_file(ctx: Ctx) -> None:
    url = f"/api/activities/{ctx.ids['run']}/fit"
    response = ctx.http.get(url)
    assert response.status_code == 200 and response.content == fit("run")
    assert response.headers["Content-Type"] == "application/vnd.ant.fit"
    assert 'filename="zankup-' in response.headers["Content-Disposition"]
    assert ctx.http.get(url, headers={"If-None-Match": response.headers["ETag"]}).status_code == 304


def test_missing_original_is_a_server_error(ctx: Ctx) -> None:
    with ctx.sessions() as db:
        activity = db.get(Activity, ctx.ids["run"])
        assert activity is not None and activity.fit_path
        (ctx.store.root / activity.fit_path).unlink()
    assert ctx.http.get(f"/api/activities/{ctx.ids['run']}/fit").status_code == 500


def test_without_a_session_nothing_is_shown(ctx: Ctx) -> None:
    ctx.http.cookies.clear()
    assert ctx.http.get("/api/activities").status_code == 401


def test_months_add_up_every_activity_in_its_local_month(ctx: Ctx) -> None:
    with ctx.sessions.begin() as db:
        # 23:30 UTC on 31 October is already November in Madrid (+01:00)
        db.execute(
            update(Activity)
            .where(Activity.id == ctx.ids["run"])
            .values(start_utc=datetime(2026, 10, 31, 23, 30, tzinfo=UTC), timezone="+01:00")
        )
        db.execute(
            update(Activity)
            .where(Activity.id != ctx.ids["run"])
            .values(start_utc=datetime(2026, 10, 10, 8, tzinfo=UTC), timezone=None)
        )
    months = ctx.http.get("/api/activities/months").json()
    assert [(m["month"], m["count"]) for m in months] == [("2026-11", 1), ("2026-10", 2)]
    with ctx.sessions() as db:
        run = db.get_one(Activity, ctx.ids["run"])
        assert months[0]["distance_m"] == pytest.approx(run.distance_m)
        assert months[0]["moving_s"] == pytest.approx(run.moving_s or run.duration_s)
    only_runs = ctx.http.get("/api/activities/months", params={"sport": "run"}).json()
    assert [m["month"] for m in only_runs] == ["2026-11"]


def test_strength_detail_has_its_sets_and_old_imports_can_be_reread(ctx: Ctx) -> None:
    from zankup.admin import queue_reprocess
    from zankup.jobs.handlers import default_handlers
    from zankup.jobs.worker import Worker

    detail = ctx.http.get(f"/api/activities/{ctx.ids['strength']}").json()
    assert [(s["kind"], s["reps"], s["category"]) for s in detail["sets"]] == [("active", 4, None)]
    assert ctx.http.get(f"/api/activities/{ctx.ids['run']}").json()["sets"] == []

    with ctx.sessions.begin() as db:  # as if imported before the parser read sets
        db.execute(update(Activity).values(sets=None))
    with ctx.sessions.begin() as db:
        user_id = db.get_one(Activity, ctx.ids["strength"]).user_id
        assert queue_reprocess(db, user_id, "strength") == 1
    worker = Worker(ctx.sessions, default_handlers(ctx.store))
    while worker.run_once():
        pass
    assert len(ctx.http.get(f"/api/activities/{ctx.ids['strength']}").json()["sets"]) == 1
