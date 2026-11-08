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
src/opensport/      the `opensport` package
  api/main.py       FastAPI app: GET /api/health (with database status)
  core/             settings (pydantic-settings) and structured logging
  db/               models, sessions and Alembic migrations
  sync/garmin.py    Garmin Personal API client (token cache, pages, FIT download, retries)
tests/
alembic.ini         migrations config (make migrate, make migration m="…")
garmin_sync.py      local tool: downloads activities into data/ with the Garmin client
```

`garmin_sync.py` reads `GARMIN_PERSONAL_API_KEY` from the root `.env` and writes to `data/` (ignored by git); its token is cached in `data/.garmin_token.json` (readable by you only):

```bash
uv run python backend/garmin_sync.py --list
```
