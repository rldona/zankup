# zankup-metrics

The Zankup metrics engine as a standalone Python package: pure functions over normalised activity streams and summaries, with no dependency on a database, an API or the network.

| Module | Metric | Method |
|---|---|---|
| `zones` | HR, power and pace zones | % of max HR, Karvonen HR reserve, Friel LTHR; Coggan power zones over FTP |
| `load` | Relative effort, fitness, fatigue, form | Banister TRIMP; 42- and 7-day exponential averages (CTL, ATL, TSB) |
| `calories` | Calories without a device value | Keytel et al. (2005) from HR, weight, age and sex; METs otherwise |
| `gap` | Grade-adjusted distance and pace | Minetti et al. (2002) energy cost of running by gradient |
| `curves` | Power, pace and HR curves | Best mean over each duration, 5 s to 2 h, on 1 Hz resampled series |
| `estimates` | FTP, critical speed, LTHR, max HR, VDOT, race times | 95 % of best 20 min or critical power; d = CS·t + D′; Daniels' VDOT; Riegel |
| `efficiency` | Aerobic efficiency and decoupling | Speed per bpm; first-half vs second-half speed/HR ratio |
| `routes` | Matched routes and segments | Start/end within 200 m, length within 10 %, mean distance of resampled tracks |
| `efforts`, `splits`, `moving` | Best efforts, splits, moving time | Interpolated cumulative distance |

Every metric documents its formula, inputs and limits, and is tested against reference values.

Licensed under the [MIT licence](LICENSE), unlike the rest of the repository (AGPL-3.0).
