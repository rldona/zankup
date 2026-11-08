"""The fixture tools keep metrics intact and the checker catches personal data."""

import math
import re
from pathlib import Path

import fitdecode
import pytest

from anonymise_fit import NEUTRAL_LAT, NEUTRAL_LON, anonymise_fit
from anonymise_track import anonymise_track
from check_fixtures import ROOT, check

SEMICIRCLE_TO_DEG = 180 / 2**31


def _messages(data: bytes) -> list[tuple[str, dict[str, object]]]:
    import io

    with fitdecode.FitReader(io.BytesIO(data), check_crc=fitdecode.CrcCheck.RAISE) as reader:
        return [
            (m.name, {f.name: f.value for f in m.fields})
            for m in reader
            if isinstance(m, fitdecode.FitDataMessage)
        ]


def test_committed_fixtures_are_clean() -> None:
    assert check(ROOT) == []


@pytest.mark.parametrize("name", ["run", "strength", "ride-power"])
def test_anonymising_keeps_every_metric(name: str) -> None:
    source = (ROOT / "fit" / f"{name}.fit").read_bytes()
    before, after = _messages(source), _messages(anonymise_fit(source))
    assert [n for n, _ in before] == [n for n, _ in after]
    session_before = next(f for n, f in before if n == "session")
    session_after = next(f for n, f in after if n == "session")
    for key in (
        "total_distance",
        "total_elapsed_time",
        "total_timer_time",
        "avg_heart_rate",
        "total_calories",
    ):
        assert session_after.get(key) == session_before.get(key)
    # Fixtures are already in the neutral week, so moving them again leaves the dates where they are.
    assert session_after["start_time"] == session_before["start_time"]


def test_dates_move_by_whole_weeks() -> None:
    from datetime import UTC, datetime

    from anonymise_fit import NEUTRAL_START, week_shift

    original = datetime(2026, 2, 14, 17, 47, 49, tzinfo=UTC)  # a Saturday
    moved = datetime.fromtimestamp(original.timestamp() + week_shift(original), UTC)
    assert moved.weekday() == original.weekday() and moved.time() == original.time()
    assert NEUTRAL_START <= moved < NEUTRAL_START.replace(day=13)


def test_track_starts_at_the_neutral_place() -> None:
    raw = (ROOT / "fit" / "run.fit").read_bytes()
    first = next(f for n, f in _messages(raw) if n == "record" and f.get("position_lat") is not None)
    assert first["position_lat"] * SEMICIRCLE_TO_DEG == pytest.approx(NEUTRAL_LAT, abs=1e-6)  # type: ignore[operator]
    assert first["position_long"] * SEMICIRCLE_TO_DEG == pytest.approx(NEUTRAL_LON, abs=1e-6)  # type: ignore[operator]


def _metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6_371_008.8 * math.asin(math.sqrt(h))


def test_gpx_is_moved_and_stripped() -> None:
    gpx = (
        '<gpx><metadata><author><name>Someone</name></author><email id="a" domain="b.c"/></metadata>'
        '<trk><trkseg><trkpt lat="40.4168" lon="-3.7038"><time>2012-06-06T19:08:53Z</time></trkpt>'
        '<trkpt lat="40.4258" lon="-3.6938"><time>2012-06-06T19:09:23Z</time></trkpt></trkseg></trk></gpx>'
    )
    out = anonymise_track(gpx, "gpx")
    assert "<author>" not in out and "<email" not in out
    assert "<time>2020-01-08T19:08:53Z</time>" in out and "<time>2020-01-08T19:09:23Z</time>" in out
    points = [(float(a), float(b)) for a, b in re.findall(r'lat="([-\d.]+)" lon="([-\d.]+)"', out)]
    assert points[0] == pytest.approx((NEUTRAL_LAT, NEUTRAL_LON), abs=1e-6)
    original = _metres((40.4168, -3.7038), (40.4258, -3.6938))
    assert _metres(points[0], points[1]) == pytest.approx(original, rel=5e-4)
    # Not just a shift: the direction of travel changes.
    assert not (points[1][0] - points[0][0] > 0 and points[1][1] - points[0][1] > 0)


def test_checker_rejects_personal_data(tmp_path: Path) -> None:
    (tmp_path / "track.gpx").write_text('<gpx><trkpt lat="40.4168" lon="-3.7038"></trkpt></gpx>')
    (tmp_path / "cassette.yaml").write_text(
        "request:\n  headers:\n    Authorization: [Bearer abcdefghijklmnop]\n"
    )
    (tmp_path / "old.tcx").write_text("<Trackpoint><Time>2019-01-13T09:50:31Z</Time></Trackpoint>")
    (tmp_path / "notes.txt").write_text("anything")
    problems = "\n".join(check(tmp_path))
    assert "outside the neutral area" in problems
    assert "auth header" in problems
    assert "unknown fixture type" in problems
    assert "is not in 2020" in problems
