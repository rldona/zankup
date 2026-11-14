"""zankup-metrics: open, documented training metrics.

Every function works on plain sequences in SI units (seconds, metres, m/s) and documents its method.
"""

from zankup_metrics.calories import calories, keytel
from zankup_metrics.curves import DURATIONS, combine, hr_curve, mean_max, power_curve, speed_curve
from zankup_metrics.efficiency import decoupling, efficiency
from zankup_metrics.efforts import RUN_DISTANCES, BestEffort, best_effort, best_efforts
from zankup_metrics.estimates import (
    RACES,
    Estimate,
    critical_speed,
    ftp,
    lthr,
    max_hr,
    predictions,
    riegel,
    vdot,
)
from zankup_metrics.gap import gap_distance
from zankup_metrics.load import EFFORT_SCALE, DailyLoad, fitness, ramp, trimp
from zankup_metrics.moving import moving_time
from zankup_metrics.routes import Match, find_segment, same_route
from zankup_metrics.smoothing import pace_s_per_km, rolling_mean
from zankup_metrics.splits import Split, splits
from zankup_metrics.zones import hr_zones, pace_zones, power_zones, time_in_zones

__version__ = "0.2.0"

__all__ = [
    "DURATIONS",
    "EFFORT_SCALE",
    "RACES",
    "RUN_DISTANCES",
    "BestEffort",
    "DailyLoad",
    "Estimate",
    "Match",
    "Split",
    "best_effort",
    "best_efforts",
    "calories",
    "combine",
    "critical_speed",
    "decoupling",
    "efficiency",
    "find_segment",
    "fitness",
    "ftp",
    "gap_distance",
    "hr_curve",
    "hr_zones",
    "keytel",
    "lthr",
    "max_hr",
    "mean_max",
    "moving_time",
    "pace_s_per_km",
    "pace_zones",
    "power_curve",
    "power_zones",
    "predictions",
    "ramp",
    "riegel",
    "rolling_mean",
    "same_route",
    "speed_curve",
    "splits",
    "time_in_zones",
    "trimp",
    "vdot",
]
