"""Ingestion of the anonymised fixtures into a throwaway database."""

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from opensport.db.models import Activity, BestEffort, Lap, Stream, User
from opensport.fit.streams import decode_polyline, decode_streams, encode_polyline, simplify
from opensport.ingest import ingest_fit
from opensport.storage import ImmutableFileError, LocalRawStore

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
GARMIN = {a["activityName"]: a for a in json.loads((FIXTURES / "garmin" / "activity-list.json").read_text())}


def fit(name: str) -> bytes:
    return (FIXTURES / "fit" / f"{name}.fit").read_bytes()


@pytest.fixture
def session(database: str) -> Iterator[Session]:
    engine = create_engine(database)
    with Session(engine) as db:
        db.add(User(email="runner@example.com"))
        db.commit()
        yield db
    engine.dispose()


def user_id(session: Session) -> int:
    return session.scalars(select(User.id)).one()


def count(session: Session, model: type) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


def test_imports_a_run_with_laps_streams_and_route(session: Session, tmp_path: Path) -> None:
    store, garmin = LocalRawStore(tmp_path), GARMIN["Running"]
    result = ingest_fit(
        session,
        store,
        user_id=user_id(session),
        source="garmin",
        external_id=str(garmin["activityId"]),
        fit=fit("run"),
        meta=garmin,
    )
    session.commit()
    activity = session.get(Activity, result.activity_id)
    assert result.created and activity is not None
    assert activity.name == "Running" and activity.sport == "run" and activity.timezone == "+01:00"
    assert activity.distance_m == pytest.approx(garmin["distance"], abs=0.01)
    assert activity.fit_path == f"{user_id(session)}/garmin/{garmin['activityId']}.fit"
    assert store.get(activity.fit_path, activity.fit_sha256) == fit("run")
    assert activity.has_gps and activity.bbox is not None and activity.raw_meta == garmin

    assert count(session, Lap) == 7
    stream = session.get(Stream, activity.id)
    assert stream is not None and stream.sample_count == 641
    series = decode_streams(stream.data)
    assert set(series) == set(stream.series) and len(series["hr"]) == 641
    assert len(stream.data) < len(fit("run"))  # compressed below the original FIT

    route = decode_polyline(activity.route_simplified or "")
    assert 2 <= len(route) <= 120
    min_lat, min_lon, max_lat, max_lon = activity.bbox
    assert all(
        min_lat - 1e-4 <= lat <= max_lat + 1e-4 and min_lon - 1e-4 <= lon <= max_lon + 1e-4
        for lat, lon in route
    )


def test_importing_again_changes_nothing(session: Session, tmp_path: Path) -> None:
    store, uid = LocalRawStore(tmp_path), user_id(session)
    first = ingest_fit(session, store, user_id=uid, source="garmin", external_id="1", fit=fit("run"))
    second = ingest_fit(session, store, user_id=uid, source="garmin", external_id="1", fit=fit("run"))
    session.commit()
    assert first.activity_id == second.activity_id and not second.created
    assert count(session, Activity) == 1 and count(session, Lap) == 7 and count(session, Stream) == 1


def test_reprocessing_rewrites_derived_rows_from_the_stored_original(
    session: Session, tmp_path: Path
) -> None:
    store, uid = LocalRawStore(tmp_path), user_id(session)
    first = ingest_fit(session, store, user_id=uid, source="garmin", external_id="1", fit=fit("run"))
    session.commit()
    session.get(Activity, first.activity_id).distance_m = 0  # type: ignore[union-attr]
    again = ingest_fit(
        session, store, user_id=uid, source="garmin", external_id="1", fit=fit("run"), reprocess=True
    )
    session.commit()
    activity = session.get(Activity, again.activity_id)
    assert (
        again.reprocessed and activity is not None and activity.distance_m == pytest.approx(6022.31, abs=0.01)
    )
    assert count(session, Lap) == 7 and count(session, Stream) == 1


def test_a_different_file_for_the_same_activity_is_refused(session: Session, tmp_path: Path) -> None:
    store, uid = LocalRawStore(tmp_path), user_id(session)
    ingest_fit(session, store, user_id=uid, source="garmin", external_id="1", fit=fit("run"))
    with pytest.raises(ImmutableFileError):
        ingest_fit(
            session, store, user_id=uid, source="garmin", external_id="1", fit=fit("strength"), reprocess=True
        )


def test_activities_without_gps_have_no_route(session: Session, tmp_path: Path) -> None:
    result = ingest_fit(
        session,
        LocalRawStore(tmp_path),
        user_id=user_id(session),
        source="garmin",
        external_id="2",
        fit=fit("strength"),
    )
    activity = session.get(Activity, result.activity_id)
    assert activity is not None and not activity.has_gps
    assert activity.route_simplified is None and activity.bbox is None and activity.name == "Strength"


def test_polyline_matches_googles_reference_example() -> None:
    points = [(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)]
    assert encode_polyline(points) == "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
    assert decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@") == points


def test_simplify_keeps_corners_and_drops_straight_points() -> None:
    line = [(0.0, 0.0), (0.0, 0.001), (0.0, 0.002), (0.001, 0.002)]
    assert simplify(line, 1e-6) == [(0.0, 0.0), (0.0, 0.002), (0.001, 0.002)]


def test_basic_metrics_match_garmin_connect(session: Session, tmp_path: Path) -> None:
    garmin = GARMIN["Running"]
    result = ingest_fit(
        session,
        LocalRawStore(tmp_path),
        user_id=user_id(session),
        source="garmin",
        external_id="1",
        fit=fit("run"),
    )
    session.commit()
    activity = session.get(Activity, result.activity_id)
    assert activity is not None
    assert activity.moving_s == pytest.approx(garmin["movingDuration"], abs=2)

    efforts = {e.distance_key: e.time_s for e in session.scalars(select(BestEffort))}
    assert efforts["1k"] == pytest.approx(garmin["fastestSplit_1000"], abs=0.2)
    assert efforts["1mile"] == pytest.approx(garmin["fastestSplit_1609"], abs=0.5)  # Garmin uses 1609 m
    assert efforts["5k"] == pytest.approx(garmin["fastestSplit_5000"], abs=0.2)
    assert set(efforts) == {"400m", "half_mile", "1k", "1mile", "2mile", "5k"}  # 6 km run: no 10k

    splits = activity.splits or []
    # 6,022 m: six full kilometres; the last 22 m are below the 50 m minimum for a split
    assert [round(s["distance_m"]) for s in splits] == [1000] * 6
    assert sum(s["time_s"] for s in splits) == pytest.approx(activity.duration_s, abs=15)
    assert all(s["avg_hr"] for s in splits)


def test_no_best_efforts_for_strength_or_rides(session: Session, tmp_path: Path) -> None:
    store, uid = LocalRawStore(tmp_path), user_id(session)
    ingest_fit(session, store, user_id=uid, source="garmin", external_id="2", fit=fit("strength"))
    ingest_fit(session, store, user_id=uid, source="garmin", external_id="3", fit=fit("ride-power"))
    session.commit()
    assert count(session, BestEffort) == 0
