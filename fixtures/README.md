# Test fixtures

Every test uses only these files. They come from real activities, anonymised so nothing in them can identify a person, and **CI fails** (`tools/check_fixtures.py`) if any file breaks the rules below.

| File | Source | What it covers |
|---|---|---|
| `fit/run.fit` | Garmin fēnix 6X Pro, outdoor run (6 km), Personal API download | GPS track, HR, cadence, laps, Garmin's private messages (blanked) |
| `fit/strength.fit` | Garmin fēnix 6X Pro, strength session | No GPS, sets and reps |
| `fit/ride-power.fit` | ROUVY virtual ride (39 min) with a smart trainer and HR strap | Power, virtual route, sensors |
| `tcx/run-2019-strava.tcx` | Strava bulk export, 2019 run, first 300 track points | TCX with whitespace before the XML declaration (Strava quirk) |
| `gpx/ride-2012-strava.gpx` | Strava bulk export, 2012 ride recorded with Endomondo | GPX with time and position only |

## Rules (checked in CI)

- **Coordinates:** every activity is moved so it starts in Hyde Park, London (51.5073, -0.1657), then mirrored and rotated around that start, so the shape of the route cannot be matched to the streets where it was recorded. Track lengths change by less than 0.05 %; the recorded distance, elevation and every other field are untouched. Every coordinate must stay within 1.5° of that point.
- **Dates:** every date moves by whole weeks to the first weeks of 2020, so weekday, time of day and durations are kept; every date in a fixture must be in 2020. The export date in GPX metadata is removed.
- **FIT:** the user profile is blank, serial numbers are `1234567890`, ANT+ IDs and digit runs in device names are zeroed, and undocumented or developer fields are blank. Laps, sessions and every metric are byte-for-byte the original.
- **TCX/GPX:** no author, e-mail or links, device unit IDs are `0`.
- **Recorded HTTP responses** (`.yaml`/`.json`, from OS-103 on): no `Authorization`, API key or cookie headers, no bearer tokens or JWTs, no e-mail addresses, and coordinates inside the neutral area.
- Any other file type fails until it gets a rule.

## Adding a fixture

```bash
uv run python tools/anonymise_fit.py data/activities/<id>.fit fixtures/fit/<name>.fit
cd tools && uv run python anonymise_track.py <export>.tcx.gz ../fixtures/tcx/<name>.tcx --max-points 300
uv run python tools/check_fixtures.py
```

Then open the file and check it by eye before committing: the checker is a safety net, not a replacement for looking.
