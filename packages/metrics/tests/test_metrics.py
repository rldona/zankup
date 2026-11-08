import pytest

import zankup_metrics as m


def steady(speed: float, seconds: int, every: int = 1) -> tuple[list[float], list[float | None]]:
    t = [float(s) for s in range(0, seconds + 1, every)]
    return t, [speed * s for s in t]


def test_version() -> None:
    assert m.__version__ == "0.1.0"


def test_best_efforts_at_a_steady_pace() -> None:
    t, d = steady(4.0, 3000)  # 12 km at 4:10/km
    efforts = {e.key: e for e in m.best_efforts(t, d)}
    assert efforts["400m"].time_s == pytest.approx(100)
    assert efforts["1k"].time_s == pytest.approx(250)
    assert efforts["1mile"].time_s == pytest.approx(1609.344 / 4)
    assert efforts["10k"].time_s == pytest.approx(2500)
    assert "15k" not in efforts and "marathon" not in efforts


def test_interpolates_between_sparse_samples() -> None:
    t, d = steady(10 / 3, 900, every=3)  # one sample every 3 s, 1 km takes exactly 300 s
    effort = m.best_effort(t, d, 1000)
    assert effort is not None and effort.time_s == pytest.approx(300)


def test_finds_the_fast_stretch_and_ignores_gps_spikes() -> None:
    t = [float(s) for s in range(0, 801)]
    d: list[float | None] = []
    for s in t:  # 3 m/s, except 4 m/s between 200 s and 450 s
        d.append(3 * s + (min(max(s - 200, 0), 250)))
    assert m.best_effort(t, d, 1000).time_s == pytest.approx(250)  # type: ignore[union-attr]
    spiky = list(d)
    spiky[400] = (spiky[400] or 0) + 900  # a GPS jump of 900 m in one second
    efforts = m.best_efforts(t, spiky, {"400m": 400.0})
    assert efforts and efforts[0].speed <= 6.0


def test_moving_time_skips_stops_and_gaps() -> None:
    t = [0.0, 1, 2, 3, 4, 5, 65, 66]
    speed: list[float | None] = [0, 3, 3, 0, 0, 3, 3, 3]
    # 0→1 and 1→2 move, 2→3 and 3→4 stopped, 4→5 moves, 5→65 is a gap, 65→66 moves
    assert m.moving_time(t, speed) == pytest.approx(4)
    assert m.moving_time(t, [None] * len(t)) is None


def test_splits_per_kilometre() -> None:
    t, d = steady(4.0, 625)  # 2.5 km
    alt: list[float | None] = [100 + s / 25 for s in t]  # +25 m over 625 s
    hr: list[int | None] = [140 if s < 250 else 160 for s in t]
    result = m.splits(t, d, alt, hr)
    assert [round(s.distance_m) for s in result] == [1000, 1000, 500]
    assert [round(s.time_s) for s in result] == [250, 250, 125]
    assert result[0].pace_s_per_km == pytest.approx(250)
    assert result[0].elevation_change_m == pytest.approx(10)
    assert result[0].avg_hr == pytest.approx(140) and result[1].avg_hr == pytest.approx(160)


def test_short_tail_is_not_a_split() -> None:
    t, d = steady(4.0, 260)  # 1040 m: the last 40 m are below the 50 m minimum
    assert len(m.splits(t, d)) == 1


def test_rolling_mean_and_pace() -> None:
    t = [0.0, 1, 2, 3, 4]
    smoothed = m.rolling_mean(t, [2.0, 4.0, None, 4.0, 2.0], window_s=2)
    assert smoothed == [3.0, 3.0, None, 3.0, 3.0]
    assert m.pace_s_per_km(4.0) == 250 and m.pace_s_per_km(0.0) is None
