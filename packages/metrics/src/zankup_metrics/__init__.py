"""zankup-metrics: open, documented training metrics.

Every function works on plain sequences in SI units (seconds, metres, m/s) and documents its method.
"""

from zankup_metrics.efforts import RUN_DISTANCES, BestEffort, best_effort, best_efforts
from zankup_metrics.moving import moving_time
from zankup_metrics.smoothing import pace_s_per_km, rolling_mean
from zankup_metrics.splits import Split, splits

__version__ = "0.1.0"

__all__ = [
    "RUN_DISTANCES",
    "BestEffort",
    "Split",
    "best_effort",
    "best_efforts",
    "moving_time",
    "pace_s_per_km",
    "rolling_mean",
    "splits",
]
