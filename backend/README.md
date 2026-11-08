# backend

FastAPI API, Garmin sync, FIT parsing and the historical computation engine. Runs on Railway.

Tooling (`uv`, `ruff`, `mypy`, `pytest`) arrives in OS-002 and the `opensport` package in OS-101.

For now it holds `garmin_sync.py`, the standard-library prototype of the Garmin Personal API client and the seed of OS-103:

```bash
python3 backend/garmin_sync.py --list
```

It reads `GARMIN_PERSONAL_API_KEY` from the root `.env` and writes to `data/` (ignored by git).
