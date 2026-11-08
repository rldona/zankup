# tools

Development scripts. They work on local data only and never write personal data into tracked files.

| Script | What it does |
|---|---|
| `build_proto_data.py` | Builds `docs/prototypes/data.js` (ignored by git) from `data/activities/` and the Strava export in `strava/` |

```bash
python3 tools/build_proto_data.py .
```

Needs `fitdecode` (`pip install fitdecode`).
