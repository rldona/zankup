# opensport-metrics

The OpenSport metrics engine as a standalone Python package: pure functions over normalised activity streams and summaries, with no dependency on a database, an API or the network.

Planned metrics (see [the roadmap](../../docs/roadmap.md), phase 3): HR, pace and power zones, relative effort (TRIMP), fitness, fatigue and form (CTL/ATL/TSB), grade-adjusted pace (Minetti), best efforts, power and pace curves, FTP and threshold estimates, VO₂max (VDOT), race predictions and calorie estimates.

Every metric documents its formula, inputs and limits, and is tested against reference values.

Licensed under the [MIT licence](LICENSE), unlike the rest of the repository (AGPL-3.0).
