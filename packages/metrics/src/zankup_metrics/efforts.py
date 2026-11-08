"""Best efforts: the fastest time over standard distances within one activity.

Method: a sliding window over the cumulative distance recorded by the device. For each sample as a
start, the end is the first sample at or beyond start + D, and the end time is interpolated linearly
between the two samples around start + D. This matches Garmin Connect's "fastest split" values to a
tenth of a second on watches that record every few seconds ("smart recording"), and Strava's best
efforts on 1 Hz files.

The device distance is used, never distance recomputed from GPS points, which is too noisy. Efforts
faster than `max_speed` are dropped as GPS errors.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from zankup_metrics._series import pairs, time_at

MILE = 1609.344
RUN_DISTANCES: dict[str, float] = {
    "400m": 400.0,
    "half_mile": MILE / 2,
    "1k": 1000.0,
    "1mile": MILE,
    "2mile": 2 * MILE,
    "5k": 5000.0,
    "10k": 10000.0,
    "15k": 15000.0,
    "10mile": 10 * MILE,
    "half_marathon": 21097.5,
    "marathon": 42195.0,
}
MAX_RUN_SPEED = 6.0  # m/s, 2:47/km: faster than this over a best-effort distance is a GPS error


@dataclass(frozen=True)
class BestEffort:
    key: str
    distance_m: float
    time_s: float
    start_s: float  # seconds from the start of the activity
    start_distance_m: float

    @property
    def speed(self) -> float:
        return self.distance_m / self.time_s


def best_effort(
    t: Sequence[float],
    dist: Sequence[float | None],
    distance_m: float,
    key: str = "",
    max_speed: float | None = None,
) -> BestEffort | None:
    """Fastest stretch of `distance_m`, or None if the activity is shorter or every candidate is too fast."""
    points = pairs(t, dist)
    if len(points) < 2 or points[-1][1] - points[0][1] < distance_m:
        return None
    best: BestEffort | None = None
    end = 0
    for start, (t0, d0) in enumerate(points):
        target = d0 + distance_m
        end = max(end, start + 1)
        while end < len(points) and points[end][1] < target:
            end += 1
        if end == len(points):
            break
        elapsed = time_at(points, end, target) - t0
        if elapsed <= 0 or (max_speed is not None and distance_m / elapsed > max_speed):
            continue
        if best is None or elapsed < best.time_s:
            best = BestEffort(key, distance_m, elapsed, t0, d0)
    return best


def best_efforts(
    t: Sequence[float],
    dist: Sequence[float | None],
    distances: dict[str, float] = RUN_DISTANCES,
    max_speed: float | None = MAX_RUN_SPEED,
) -> list[BestEffort]:
    """Best effort for every standard distance the activity covers, shortest first."""
    points = pairs(t, dist)
    covered = points[-1][1] - points[0][1] if points else 0.0
    results = []
    for key, distance in sorted(distances.items(), key=lambda item: item[1]):
        if distance > covered:
            break
        effort = best_effort(t, dist, distance, key, max_speed)
        if effort is not None:
            results.append(effort)
    return results
