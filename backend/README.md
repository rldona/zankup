# backend

FastAPI API, Garmin sync, FIT parsing and the historical computation engine. Runs on Railway.

Python 3.12+ managed with [uv](https://docs.astral.sh/uv/) as part of the workspace at the repository root (together with `packages/metrics`). Run everything from the root:

```bash
uv sync                        # create .venv with both packages and the dev tools
uv run pytest                  # tests
uv run ruff check              # lint
uv run ruff format             # format
uv run mypy                    # strict type checking
uv run pre-commit install      # run ruff and mypy on every commit
uv run uvicorn opensport.api.main:app --reload   # API on http://127.0.0.1:8000/api/health
```

Layout:

```
src/opensport/      the `opensport` package (structure grows in OS-101)
  api/main.py       FastAPI app, currently only GET /api/health
tests/
garmin_sync.py      standard-library prototype of the Garmin Personal API client (seed of OS-103)
```

`garmin_sync.py` reads `GARMIN_PERSONAL_API_KEY` from the root `.env` and writes to `data/` (ignored by git):

```bash
uv run python backend/garmin_sync.py --list
```
