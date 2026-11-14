"""Phase 3 metrics against hand-computed reference values."""

import math
from datetime import date, timedelta

import pytest

import zankup_metrics as m
from zankup_metrics.calories import mets
from zankup_metrics.gap import cost


def series(seconds: int, value: float) -> tuple[list[float], list[float | None]]:
    t = [float(s) for s in range(seconds + 1)]
    return t, [value] * len(t)


def test_hr_zone_models() -> None:
    assert m.hr_zones("max", 190) == pytest.approx([95, 114, 133, 152, 171])
    assert m.hr_zones("reserve", 190, hr_rest=50) == pytest.approx([120, 134, 148, 162, 176])
    assert m.hr_zones("lthr", 190, lthr=170) == pytest.approx([0, 144.5, 153, 161.5, 170])
    with pytest.raises(ValueError):
        m.hr_zones("reserve", 190)
    assert m.power_zones(200)[3] == pytest.approx(180)
    assert m.pace_zones(4.0)[-1] == pytest.approx(4.0)


def test_time_in_zones_skips_pauses() -> None:
    t = [0.0, 10, 20, 100, 110]
    hr: list[float | None] = [120, 150, 150, 170, 170]
    zones = m.time_in_zones(t, hr, m.hr_zones("max", 190))
    assert zones == pytest.approx([0, 10, 10, 10, 0])  # 120, 150 and 170 bpm; the 80 s gap counts nothing


def test_trimp_matches_banisters_formula() -> None:
    t, hr = series(3600, 120)  # HR reserve fraction 0.5 with rest 50, max 190
    expected = 60 * 0.5 * 0.64 * math.exp(1.92 * 0.5) * m.EFFORT_SCALE
    assert m.trimp(t, hr, 190, 50, "male") == pytest.approx(expected, rel=1e-3)
    women = 60 * 0.5 * 0.86 * math.exp(1.67 * 0.5) * m.EFFORT_SCALE
    assert m.trimp(t, hr, 190, 50, "female") == pytest.approx(women, rel=1e-3)
    assert m.trimp(t, hr, 190, 50, "female") > m.trimp(t, hr, 190, 50, "male")
    hard = m.trimp(*series(3600, 170), 190, 50, "male")
    assert hard > 2.5 * expected  # exponential in intensity


def test_fitness_fatigue_and_form() -> None:
    start = date(2026, 1, 1)
    loads = {start + timedelta(days=i): 100.0 for i in range(200)}
    days = m.fitness(loads, start + timedelta(days=199))
    assert days[0].ctl == pytest.approx(100 / 42) and days[0].atl == pytest.approx(100 / 7)
    assert days[0].tsb == 0  # before any training
    assert days[-1].ctl == pytest.approx(100, rel=0.01) and days[-1].atl == pytest.approx(100, rel=1e-6)
    rest = m.fitness(loads, start + timedelta(days=209))
    assert rest[-1].tsb > 0  # ten days off: fresh
    assert m.ramp(days[:30]) is not None and m.ramp(days[:30]) > 0  # type: ignore[operator]
    assert m.fitness({}, start) == []


def test_keytel_calories() -> None:
    per_minute = (-55.0969 + 0.6309 * 150 + 0.1988 * 70 + 0.2017 * 35) / 4.184
    assert m.keytel(150, 60, 70, 35, "male") == pytest.approx(per_minute * 60)
    assert m.calories("run", 60, 150, 70, 35, "male") == pytest.approx(per_minute * 60)
    assert m.calories("run", 60, None, 70, None, None) == pytest.approx(mets("run", 60, 70)) == 9.8 * 70
    assert m.calories("run", 60, 150, None, 35, "male") is None


def test_grade_adjusted_distance() -> None:
    assert cost(0) == pytest.approx(3.6)
    flat = [float(d) for d in range(0, 1001, 10)]
    assert m.gap_distance(flat, [100.0] * len(flat)) == pytest.approx(1000)
    climb = [100 + 0.1 * d for d in flat]  # 10 % uphill
    assert m.gap_distance(flat, climb) == pytest.approx(1000 * cost(0.1) / 3.6, rel=0.01)
    assert m.gap_distance(flat, [None] * len(flat)) is None


def test_curves() -> None:
    t, power = series(1300, 200)
    for second in range(100, 160):
        power[second] = 400
    curve = m.power_curve(t, power)
    assert curve[60] == pytest.approx(400) and curve[1200] == pytest.approx(210, rel=0.01)
    assert 3600 not in curve
    dist = [4.0 * s for s in t]
    assert m.speed_curve(t, dist)[600] == pytest.approx(4.0)
    assert m.combine([{60: 300, 300: 250}, {60: 320}]) == {60: 320, 300: 250}
    paused = m.power_curve([0, 1, 100, 101], [300, 300, 300, 300])
    assert paused[60] < 300  # the pause is not ridden at 300 W


def test_estimates() -> None:
    ftp = m.ftp({1200: 250})
    assert ftp is not None and ftp.value == pytest.approx(237.5)
    cp = m.ftp({180: 350, 720: 280})
    assert cp is not None and cp.value == pytest.approx((280 * 720 - 350 * 180) / 540)
    cs = m.critical_speed([(1600, 400), (5000, 1300), (400, 60)])
    assert cs is not None and cs.value == pytest.approx(3400 / 900)
    assert m.lthr({1200: 170}).value == pytest.approx(161.5)  # type: ignore[union-attr]
    assert m.max_hr([180, 191, 250]).value == 191  # type: ignore[union-attr]
    assert m.vdot(5000, 1200) == pytest.approx(49.8, abs=0.3)  # Daniels' tables: 20:00 → 49.8
    assert m.riegel(10000, 2400, 21097.5) == pytest.approx(2400 * 2.10975**1.06)
    predicted = m.predictions([(5000, 1200), (10000, 2700), (1000, 200)])
    assert predicted["10k"].value == pytest.approx(m.riegel(5000, 1200, 10000))  # the 5 km is the stronger


def _line(
    n: int, lat0: float = 40.4, lon0: float = -3.7, step: float = 0.0005, shift: float = 0.0
) -> list[tuple[float, float]]:
    return [(lat0 + i * step + shift, lon0 + math.sin(i / 8) * 0.002) for i in range(n)]


def test_matched_routes() -> None:
    a = _line(60)
    assert m.same_route(a, _line(60, shift=0.0001))  # about 11 m apart
    assert not m.same_route(a, _line(60, shift=0.003))  # over 300 m apart
    assert not m.same_route(a, _line(30))  # half as long


def test_segments_are_found_in_a_track() -> None:
    track = _line(100)
    segment = track[30:60]
    match = m.find_segment(segment, [None, *track])  # a missing sample at the start
    assert match is not None and abs(match.start - 31) <= 1 and abs(match.end - 60) <= 1
    assert m.find_segment(segment, _line(100, shift=0.01)) is None


def test_efficiency_and_decoupling() -> None:
    t = [float(s) for s in range(0, 3601, 10)]
    dist = [3.0 * s for s in t]
    steady = m.decoupling(t, dist, [150.0] * len(t))
    assert steady == pytest.approx(0, abs=0.5)
    drift = m.decoupling(t, dist, [140.0 if s < 1800 else 160.0 for s in t])
    assert drift is not None and drift > 10
    assert m.efficiency(10000, 3000, 150) == pytest.approx(200 / 150)
