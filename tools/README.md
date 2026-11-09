# tools

Development scripts. They work on local data only and never write personal data into tracked files.

| Script | What it does |
|---|---|
| `build_proto_data.py` | Builds `docs/prototypes/data.js` (ignored by git) from `data/activities/` and the Strava export in `strava/` |
| `anonymise_fit.py` | Turns a real FIT file into a test fixture (positions moved to a neutral place, profile and IDs removed, metrics untouched) |
| `anonymise_track.py` | The same for TCX and GPX files, optionally keeping only the first N points |
| `scrub_garmin_list.py` | Turns saved Garmin activity-list items into a response fixture (fake IDs, no owner or location, moved dates and coordinates) |
| `check_fixtures.py` | Fails if anything under `fixtures/` contains personal data. Runs in CI |
| `usb_import.py` | Sends the new FIT files of a Garmin watch connected by USB to your Zankup, through the normal import (OS-608) |

```bash
python3 tools/build_proto_data.py .
```

`build_proto_data.py` needs `fitdecode` (`pip install fitdecode`); the fixture tools run with `uv run` (see [fixtures/README.md](../fixtures/README.md)). Tests live in `tools/tests/`.
