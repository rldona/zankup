"""The parser reproduces Garmin's own numbers for the three anonymised fixtures."""

import json
from pathlib import Path

import pytest

from zankup.fit.parser import FitParseError, normalise_sport, parse_fit

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
GARMIN = {a["activityName"]: a for a in json.loads((FIXTURES / "garmin" / "activity-list.json").read_text())}
CASES = [
    ("run", "Running", "run"),
    ("strength", "Strength Training", "strength"),
    ("ride-power", "Virtual Ride", "ride"),
]


def parse(name: str):  # type: ignore[no-untyped-def]
    return parse_fit((FIXTURES / "fit" / f"{name}.fit").read_bytes())


@pytest.mark.parametrize(("fixture", "garmin_name", "sport"), CASES)
def test_matches_garmin_connect(fixture: str, garmin_name: str, sport: str) -> None:
    activity, garmin = parse(fixture), GARMIN[garmin_name]
    assert activity.sport == sport
    assert activity.distance_m == pytest.approx(garmin["distance"], abs=0.01)
    assert activity.timer_s == pytest.approx(garmin["duration"], abs=0.01)
    assert activity.duration_s == pytest.approx(garmin["elapsedDuration"], abs=0.01)
    assert activity.avg_hr == garmin["averageHR"] and activity.max_hr == garmin["maxHR"]
    assert activity.calories == garmin["calories"]
    assert activity.avg_power == garmin.get("avgPower") and activity.normalized_power == garmin.get(
        "normPower"
    )
    if garmin.get("elevationGain") is not None:
        assert activity.ascent_m == pytest.approx(garmin["elevationGain"], abs=1)
    assert activity.start_utc.strftime("%Y-%m-%d %H:%M:%S") == garmin["startTimeGMT"]


def test_run_streams_cadence_and_gps() -> None:
    run = parse("run")
    assert len(run.streams) == 641 and run.has_gps
    assert {"t", "lat", "lon", "dist", "alt", "hr", "cad", "speed"} <= set(run.streams.present())
    assert run.streams.t[0] == 0 and run.streams.t[-1] == pytest.approx(run.duration_s, abs=5)
    assert run.avg_cadence == pytest.approx(
        GARMIN["Running"]["averageRunningCadenceInStepsPerMinute"], abs=0.6
    )
    steps = [c for c in run.streams.cad if c]
    assert 150 < sum(steps) / len(steps) < 180  # steps per minute, not strides
    assert run.bbox is not None and run.bbox[0] == pytest.approx(51.5, abs=0.1)
    assert run.timezone == "+01:00" and run.device == "Garmin fenix6x"
    assert len(run.laps) == 7 and sum(lap.distance_m or 0 for lap in run.laps) == pytest.approx(
        run.distance_m, abs=1
    )


def test_strength_has_no_track() -> None:
    strength = parse("strength")
    assert not strength.has_gps and strength.bbox is None
    assert strength.sub_sport == "strength_training" and strength.distance_m == 0


def test_indoor_ride_has_power_and_its_app_as_device() -> None:
    ride = parse("ride-power")
    assert "power" in ride.streams.present()
    powers = [p for p in ride.streams.power if p is not None]
    assert sum(powers) / len(powers) == pytest.approx(199, abs=3)
    assert ride.device == "Rouvy" and ride.sub_sport == "virtual_activity"
    assert ride.timezone == "+02:00"


@pytest.mark.parametrize(
    ("sport", "sub_sport", "expected"),
    [
        ("running", "trail", "run"),
        ("cycling", "indoor_cycling", "ride"),
        ("fitness_equipment", "indoor_rowing", "row"),
        ("training", "strength_training", "strength"),
        ("hiking", None, "walk"),
        ("golf", None, "other"),
        (None, None, "other"),
    ],
)
def test_sport_mapping(sport: str | None, sub_sport: str | None, expected: str) -> None:
    assert normalise_sport(sport, sub_sport) == expected


def test_rejects_files_that_are_not_activities() -> None:
    with pytest.raises(FitParseError):
        parse_fit(b"not a fit file at all")
