# Zankup

**All your sports data together.**

Zankup is an open source, self-hosted alternative to Strava for your own training data. It syncs your Garmin activities automatically through the official Garmin Connect Personal API, keeps the original FIT files, imports your full Strava history and computes the advanced metrics that other platforms keep behind a subscription: relative effort, fitness and form, best-effort curves, FTP and threshold estimates, race predictions and more.

Each person runs their own instance with their own keys. There is no central service and nobody else's health data lives on our servers.

> **Status:** milestones 1 and 2 are done: Garmin sync every 15 minutes and the full history from the app, an installable PWA that works offline (feed, activity detail with map and charts, strength sets, search, stats, profile, settings, eight themes, English and Spanish), and sign-in with password and TOTP, passkeys or Google. See the [roadmap](docs/roadmap.md).
>
> **Run your own:** [self-hosting guide](docs/self-hosting.md) (your server with one `docker compose`, or Railway and Vercel).
>
> Coming from a local database made before the rename? See [moving a local database](docs/brand/README.md#moving-a-local-database).

## Getting started (local development)

You need **Git**, **Docker** (with Compose), **[uv](https://docs.astral.sh/uv/getting-started/installation/)**, **Node.js 22+** (it brings corepack, which provides the pinned pnpm) and **make**.

```bash
git clone https://github.com/rldona/zankup.git && cd Zankup
make setup   # uv sync, pnpm install, creates .env from .env.example and the data/ folder
make dev     # Postgres + API in Docker, then the web app
```

- Web app: http://localhost:5173 (shows "API connected" when everything is up)
- API: http://localhost:8000/api/health · interactive docs at http://localhost:8000/api/docs
- Postgres: `postgresql://zankup:zankup@127.0.0.1:5432/zankup`

The API reloads when you edit `backend/src` or `packages/metrics/src`. To sync real activities, put your own Garmin Personal API key in `.env` (see the comments in [`.env.example`](.env.example)); everything else is optional.

The first time you open the app it goes to **/setup** to create the instance's only account: the setup code it asks for is in the API's logs (`docker compose logs api`, or Railway → Deployments → Logs).

Other tasks: `make test`, `make lint`, `make format`, `make check` (what CI runs), `make generate-api` (after changing an endpoint) and `make stop`. `make help` lists them all.

## Documentation

| Document | What it covers |
|---|---|
| [Self-hosting](docs/self-hosting.md) | Your own instance: keys, your server or Railway + Vercel, updates, backups, every variable |
| [Architecture](docs/architecture.md) · [visual map](docs/architecture.html) | Components, deployment (Railway + Vercel), data model, API and product model |
| [Roadmap](docs/roadmap.md) | Phases, tickets and definitions of done (also tracked as GitHub issues) |
| [Findings](docs/findings.md) | Research on data sources and why this architecture |
| [Strava export analysis](docs/strava-export-analysis.md) | What FIT and GPX exports contain and how Strava's numbers are reproduced |
| [Prototypes](docs/prototypes/index.html) | Clickable desktop and mobile prototypes (need locally generated data) |
| [Brand guide](docs/brand/README.md) | The new name (Zankup), mark, wordmark, assets and the migration checklist |

## Repository layout

```
backend/            Python · FastAPI API, sync and computation engine (Railway)
apps/web/           PWA · React + Vite (Vercel)
apps/mobile/        Android app · React Native + Expo (phase 5)
packages/core/      Shared TypeScript: API client, hooks, formatting, design tokens, i18n
packages/metrics/   Python · zankup-metrics: pure metric algorithms (MIT)
tools/              Development scripts
docs/               Documentation and prototypes
```

## Privacy

Activity files contain real routes (including where you start and finish) and personal profile data. Nothing personal is ever committed: `data/`, `strava/`, `.env` and generated prototype data are ignored by git. Tests use anonymised fixtures only.

## Licence

- `packages/metrics/` is released under the [MIT licence](packages/metrics/LICENSE), so anyone can reuse the metrics engine.
- Everything else is released under the [GNU Affero General Public License v3.0](LICENSE): you can run, modify and share it, and if you offer a modified version as a service, its source must be available to its users.

Copyright © 2026 Raúl López and Zankup contributors.
