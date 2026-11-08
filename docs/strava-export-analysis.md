# Analysis of Strava exports (FIT vs GPX)

Reference activity: **"Carrera de noche"** (night run), 27/10/2026, Garmin fēnix 6X, free Strava account (activity 20754337343).
Files: `Carrera_de_noche.fit` (Export Original) and `Carrera_de_noche.gpx` (Export GPX), plus screenshots of the website. The files are kept locally only, outside git, because they contain a real route.

## What each file contains

| | FIT (Export Original) | GPX (Export GPX) |
|---|---|---|
| Points | 2,257, one per second | The same 2,257 (identical position, altitude, HR and time) |
| Per point | Position, barometric altitude, speed, **cumulative distance**, HR, cadence, temperature, stride length | Position, altitude, time, HR, cadence, temperature |
| Laps | 7 automatic 1 km laps (HR, cadence, elevation, calories, strides) | ❌ |
| Session summary | 6,615 m, +60/−74 m, 574 kcal, Training Effect 3.5, training load 104 | ❌ |
| HR zones and time in each zone | ✅ | ❌ |
| Device and sensors | fēnix 6X, barometer, GPS, wrist HR sensor… | Only `creator="StravaGPX"` |
| User profile | Weight, height, sex, resting HR | ❌ |

## Mapping to the Strava website

- **Summary** (6.61 km · 37:37 · 5:41/km · 60 m · 574 kcal): matches the FIT session summary. Strava uses the watch's elevation gain and does not recompute it.
- **Laps tab**: the FIT laps, as they are (e.g. 340 s = 5:40).
- **Per-km splits in the overview**: Strava computes them from the cumulative distance.
- **Best efforts**: recomputed from the FIT's cumulative distance, they come out identical:

  | Distance | Strava | Recomputed |
  |---|---|---|
  | 400 m | 2:03 | 2:03 |
  | ½ mile | 4:18 | 4:18 |
  | 1 km | 5:27 | 5:27 |
  | 1 mile | 8:47 | 8:47 |
  | 2 miles | 17:57 | 17:56 (rounding) |
  | 5 km | 28:06 | 28:06 |

- **Cadence of 164 spm**: the FIT stores 82 per leg, so it must be multiplied by 2.

## GPX limitations

- **Distance**: summing point-to-point distances with haversine gives 6,730 m instead of 6,615 m (+1.7%, due to GPS noise). The track needs smoothing.
- **Elevation**: summing the raw altitude gives +106 m instead of +60 m. It needs a filter or a hysteresis threshold.
- No laps, summary or zones.

## What only exists on Strava (in no export)

- Segments (Strava's database; this activity has 13).
- Relative Effort (paid), Flybys, kudos, shoes and their mileage, activity description.

> **Correction (7 Nov 2026):** the bulk export does include descriptions, photos, the gear used on each activity and even the Relative Effort value. What it does not export is segment efforts. Details in [findings.md](findings.md#10-strava-bulk-export-checked-against-the-real-history).

## Privacy

- On the website, the start and the end show as **"Hidden"** because of the privacy zone, but **both exports contain the full route**, including the starting point.
- The FIT includes personal profile data (weight, height).
- For OpenSport: treat these files as sensitive data, implement our own privacy zones for anything shared, and never upload them to public repositories.

## Conclusions for OpenSport

1. **Use the FIT as the main source**: it reproduces every metric Strava shows for free, and it also has laps, zones and Training Effect.
2. **Use the GPX as a fallback** for other sources, processing it to get believable distance and elevation.
3. **Compute HR zones with OpenSport's own settings**: the watch has an unrealistic lactate threshold of 86 bpm, which is why the FIT puts all the time in zone 5.
4. `fitdecode` works well for reading FIT in Python (coordinates come as semicircles: degrees = value × 180 / 2³¹).
