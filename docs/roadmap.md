# OpenSport roadmap

Development plan by phases, with small tickets and deliverables that are usable from the end of each phase.

References: [architecture.md](architecture.md) · [findings.md](findings.md) · [prototypes](prototypes/index.html)

## Overview

| Phase | Goal | Usable deliverable | Milestone |
|---|---|---|---|
| **0 · Foundations** | Repository, CI and environments ready | Empty deployment on Railway and Vercel | — |
| **1 · Backend on Railway** | Sync and store activities in the cloud | API with your activities, synced automatically every 15 min | **M1: "my data lives in OpenSport"** |
| **2 · PWA MVP** | See activities on desktop and mobile | Installable PWA with feed, detail with map, search and Sync button, in English and Spanish | **M2: "I use OpenSport instead of Strava to see my activities"** |
| **3 · Advanced metrics** | The "Premium" metrics, built by us | Complete stats screen | **M3: "I know how fit I am"** |
| **4 · Notifications, history and privacy** | Notifications, the full history and safe sharing | Push, Strava ZIP import, privacy zones | **M4: "OpenSport replaces Strava"** |
| **5 · Android app (React Native)** | Expo app on the shared code, background sync and FCM (stack confirmed by the OS-501 proof of concept at the start of phase 2) | App on the Play Store (internal testing) | **M5: Android app** |
| **6 · Multi-source health** | Sleep, HRV and daily data from Garmin and Google Health (Fitbit Air), without duplicates | Health dashboard | **M6: "I see my recovery, wherever it comes from"** |
| **7 · AI assistant** | Summaries, analysis and natural-language questions with a small LLM (Claude Haiku 5.5) | Per-activity summary, weekly report and "Coach" chat | **M7: "I ask OpenSport how I'm doing"** |

**Size estimate:** S ≈ half a day · M ≈ 1–2 days · L ≈ 3–5 days. Rough totals: M1 ≈ 20–25 working days (phases 0 and 1), M2 ≈ another 30–35.

**Tracking:** every ticket is a GitHub issue with `phase-N`, `size-S/M/L` and `type` labels and a milestone per phase; dependencies are linked in each issue. This file remains the plan; the issues are the work.

**Product model:**
- **Open source and self-hosted.** Each person deploys their own instance (Railway + Vercel, or Docker on their own server) and uses **their own keys**: Garmin Personal API, Google OAuth, Google Health and, optionally, Anthropic. That keeps every instance within the Garmin Personal API's personal-use terms, and nobody else's health data lives on our servers.
- **Licences:** `packages/metrics` (the metrics engine) under **MIT**, so anyone can reuse it; everything else under **AGPL-3.0**, so hosted forks stay open.
- **No payments for now.** Nothing in the design should close the door to a hosted version later: every table carries `user_id` from the start, even though each deployment has a single user.
- **Brand decided, not applied yet.** The product will be called **Zankup**; the name, mark and wordmark are in the [brand guide](brand/README.md). OpenSport stays in the code until the rename (guide, section 7); the mark and icons are #116 and the domain is OS-D06. Instances run on their `*.vercel.app` and `*.up.railway.app` URLs.

**Working rules:**
- One ticket = one branch = one small PR with tests.
- Commits, PRs, branches, docs and code comments are written in English.
- Every phase ends with something deployed and usable.
- Anything not critical for the phase milestone moves to the next phase.

---

## Already done (discovery phase)

| Ticket | What | Result |
|---|---|---|
| OS-D01 | Research data sources (Strava, Garmin, phone, USB, intermediaries) | [findings.md](findings.md) |
| OS-D02 | Sync prototype with the Garmin Personal API | `backend/garmin_sync.py` (was `sync/`), 72 activities downloaded |
| OS-D03 | Validate that the API's FIT is the complete original | Byte-for-byte identical to "Export File" |
| OS-D04 | Architecture (Railway + Vercel + Android) | [architecture.md](architecture.md) |
| OS-D05 | Desktop and mobile prototypes with real data (full history: 1,819 activities since 2011) | [prototypes/](prototypes/index.html) |

---

## Decisions before starting

These are owner decisions, tracked as issues with the `decision` label.

- **OS-D07 · Choose the licence and repository visibility** (S) · **decided**
  - MIT for `packages/metrics`, AGPL-3.0 for the rest of the repository, public repository (see "Product model" above). Applied in OS-001.
  - *Done when:* `LICENSE` (AGPL-3.0) is at the root, `packages/metrics/LICENSE` (MIT) is in place and the repository is public.
- **OS-D08 · Create the service accounts for your own instance** (S)
  - Railway, Vercel, Resend, Google Cloud and Anthropic (optional). Expected cost at the start: about $5–10/month. The same list becomes the self-hosting guide (OS-224).
  - *Done when:* every account exists and its keys are stored only in Railway's variables and the local `.env`.

The production domain (OS-D06) moved to the [backlog](#backlog): a stable `*.vercel.app` URL is enough for now.

## Phase 0 · Foundations

**Goal:** any change reaches production with a `git push`.

- **OS-001 · Repository and structure** (S)
  - pnpm-workspaces monorepo: `backend/`, `apps/web/`, `apps/mobile/` (empty until phase 5), `packages/core/`, `packages/metrics/`, `docs/` and `tools/`. `README`, licences (OS-D07: AGPL-3.0 at the root, MIT in `packages/metrics/`) and `.gitignore` (including `.env`, `data/`, `strava/`, `docs/prototypes/data.js` and the sample files with personal data).
  - Migrate what already exists: `sync/garmin_sync.py` → `backend/` (as the seed of OS-103), `tools/build_proto_data.py` stays in `tools/`, prototypes stay in `docs/prototypes/`. Translate code comments and messages to English.
  - *Done when:* the structure is in place, nothing personal or secret is tracked, and the existing scripts still run from their new location.
- **OS-002 · Backend tooling** (S) · depends on OS-001
  - Python 3.12+, `uv`, `ruff`, `mypy` and `pytest`, with `pre-commit`.
  - *Done when:* `uv run pytest` and `ruff check` pass locally.
- **OS-003 · Web tooling** (S) · depends on OS-001
  - Vite + React + TypeScript, `eslint`, `prettier`, `vitest` and pnpm.
  - *Done when:* `pnpm dev`, `pnpm test` and `pnpm build` work.
- **OS-008 · Shared package `packages/core`** (S) · depends on OS-001 and OS-003
  - Strict TypeScript. API client generation from OpenAPI, formatting and domain utilities (the prototype's), design tokens in JSON and the `en`/`es` i18n catalogues. Tests with vitest. The PWA uses it from day one.
- **OS-009 · Local development environment** (S) · depends on OS-002 and OS-003
  - `docker compose` with Postgres (and the API in watch mode), `.env.example` with every variable, and `make dev` / `make test` (or `just`) to start everything with one command. Short "Getting started" section in the README.
  - *Done when:* a fresh clone runs the API, the database and the web app locally in under 10 minutes following the README.
- **OS-010 · Anonymised test fixtures** (M) · depends on OS-001
  - A `tools/anonymise_fit` script that produces test FITs from real ones: coordinates shifted to a neutral location, user profile (weight, height, sex, resting HR) removed, serial numbers and IDs replaced, timing and metrics kept. Fixtures for run, strength, indoor ride with power and an old TCX/GPX.
  - Recorded HTTP responses (VCR cassettes) for the Garmin and Google APIs are scrubbed of tokens, keys, emails and real IDs before being committed, with a CI check that fails if a cassette contains an `Authorization` header or coordinates outside the neutral area.
  - *Done when:* every test uses only anonymised fixtures and the CI check is active.
- **OS-004 · CI on GitHub Actions** (S) · depends on OS-002 and OS-003
  - Lint, tests and build for the backend and the web on every PR.
  - *Done when:* a PR shows green checks.
- **OS-005 · Railway project** (S) · depends on OS-002
  - API service with a Dockerfile, Postgres, a `/data` volume and environment variables (`GARMIN_PERSONAL_API_KEY`, `JWT_SECRET`, `DATABASE_URL`). Automatic deploys from `main`.
  - *Done when:* `GET /api/health` responds on the Railway URL.
- **OS-006 · Vercel project** (S) · depends on OS-003 and OS-005
  - Build of `apps/web/`, `vercel.json` with `rewrites /api/* → Railway` and per-PR previews.
  - *Done when:* the empty web app calls `/api/health` through the proxy.
- **OS-007 · Rotate the Garmin key** (S)
  - Delete the key that was pasted into the chat, create a new one and store it only on Railway and in the local `.env`.
  - *Done when:* the old key returns 401.

## Phase 1 · Backend on Railway → **M1**

**Goal:** activities sync on their own and are stored, parsed and served by the API.

- **OS-101 · `opensport` package and configuration** (S) · depends on OS-002
  - Structure `opensport/{api,sync,fit,db,core}`. Configuration with `pydantic-settings` and structured logging.
  - The metric algorithms live in **`packages/metrics`** (Python package `opensport-metrics`, MIT): pure functions over normalised streams and summaries, with no dependency on the database, the API or the network, so other projects can use them. The backend imports it.
- **OS-102 · Database schema and migrations** (M) · depends on OS-101
  - SQLAlchemy + Alembic. Tables `activities`, `laps`, `streams`, `sync_runs`, `settings`, `users` and `devices` (model in [architecture.md](architecture.md)).
  - Every user-owned table has a `user_id` column and every query filters by it, even with a single user per instance. It costs almost nothing now and avoids a painful migration if a hosted version ever exists.
  - *Done when:* `alembic upgrade head` creates the schema locally and on Railway.
- **OS-103 · Garmin Personal API client** (M) · depends on OS-101 and OS-010
  - Turn `garmin_sync.py` into a module: cached token (in the database, not a file), paginated list, ZIP download and FIT extraction, retries on 429.
  - *Done when:* tests with recorded responses (VCR, scrubbed as in OS-010) cover the token, the list and the download.
- **OS-104 · Original FIT store** (S) · depends on OS-101
  - Immutable `/data/raw/{activityId}.fit`, with its `sha256` stored. An interface that allows switching to object storage later.
- **OS-105 · FIT parser → normalised model** (M) · depends on OS-102 and OS-010
  - Session, laps, 1 Hz streams (lat, lon, distance, altitude, HR, cadence ×2, speed, power, temperature) and device. Semicircles → degrees.
  - *Done when:* tests with the anonymised run, strength and ROUVY fixtures (OS-010) match Garmin's numbers.
- **OS-106 · Ingestion: store activity, laps and streams** (M) · depends on OS-104 and OS-105
  - Idempotent by `activityId`. Compressed streams. Simplified route for thumbnails and `bbox`.
- **OS-107 · Basic metrics on import** (M) · depends on OS-106
  - Smoothed pace and speed, per-km splits and best efforts (400 m … marathon), validated against the Strava numbers in [findings.md](findings.md). GPS speed spikes are filtered out before computing records.
- **OS-108 · Sync orchestrator** (M) · depends on OS-103, OS-106 and OS-115
  - `sync_run` with status and progress, incremental since the last sync, and a lock so two never run at once.
  - *Done when:* `python -m opensport.sync` imports what is new and a second run does nothing.
- **OS-109 · Cron on Railway** (S) · depends on OS-108
  - Every 15 min. Done as a scheduler thread next to the worker (a Railway Cron Job cannot reach the API's volume), queuing one sync job per time slot.
  - *Done when:* a new activity from the watch shows up in the database with no intervention.
- **OS-110 · Authentication** (L) · depends on OS-102
  - One user per instance. Sign-in with password + TOTP (passkeys are in the backlog, OS-405). `httpOnly` session cookie for the web and access + refresh tokens for Android. Rate limiting.
  - *Done when:* every route except `/health` and `/auth/*` returns 401 without a session.
- **OS-111 · Activities API** (M) · depends on OS-107 and OS-110
  - `GET /api/activities` (cursor pagination), `GET /api/activities/{id}`, `/streams` (gzip) and `/fit`. OpenAPI published.
- **OS-112 · Sync API** (S) · depends on OS-108 and OS-110
  - `POST /api/sync` and `GET /api/sync/{id}` with progress.
- **OS-113 · Initial Garmin history load** (S) · depends on OS-108
  - `sync --since YYYY-MM-DD` command, with pauses, to bring in everything on Garmin Connect.
- **OS-114 · Observability and backups** (S) · depends on OS-005
  - Structured logs in Railway, an email alert (Resend) if sync fails 3 times in a row, and daily backups of Postgres and the volume. Error tracking with Sentry is in the backlog.
  - *Done when:* a backup has been restored into a fresh database and volume and the app works with it (restore tested, not just backup).
- **OS-115 · Job queue and worker** (M) · depends on OS-102
  - `jobs` table in Postgres (with `SKIP LOCKED`), retries with backoff and a worker that is the same container started in worker mode on Railway. Sync and ingestion become jobs.
  - *Done when:* importing 70 activities does not block the API and a failure retries on its own.

**M1 is done when** activities from the watch appear on their own in the Railway API, with basic metrics, in under 15 minutes.

## Phase 2 · PWA MVP → **M2**

**Goal:** use OpenSport every day on desktop and mobile.

- **OS-501 · React Native performance proof of concept** (M) · depends on OS-008 and OS-111
  - **Runs first in this phase**, right after M1, so the React Native vs Kotlin decision is made before the PWA and `packages/core` take shape. The rest of the Android app stays in phase 5.
  - In 2–3 days, only the activity detail in Expo: MapLibre map, profile drawn with Skia, cursor synced with Reanimated and section selection, with real data from the API.
  - *Done when:* on a mid-range phone cold start is under 1.5 s, dragging runs at 60 fps and memory is reasonable, and the decision (React Native or Kotlin) is written down in `docs/architecture.md`. If Kotlin wins, `packages/core` keeps only what the PWA needs and phase 5 is re-planned.

- **OS-201 · App skeleton** (M) · depends on OS-003 and OS-006
  - Router, TanStack Query, API client generated from OpenAPI and the design-token structure (full themes in OS-214).
- **OS-223 · Internationalisation (English and Spanish)** (M) · depends on OS-201 and OS-008
  - i18next (`react-i18next`) with the shared catalogues in `packages/core/i18n/{en,es}.json`, ICU messages for plurals and variables, and `Intl` formatting for dates, numbers, durations and paces.
  - **English by default.** On first visit, the browser language is used if supported, otherwise English. Settings → Language switches between English and Spanish, stored in `localStorage` (no flicker) and in the user's settings on the backend (follows you across devices and reaches the Android app).
  - Units (metric or imperial) are a separate setting from the language.
  - Server-generated text (emails, push notifications, share cards, AI summaries) uses the stored language. Activity names and descriptions are never translated.
  - The public screens (sign-in, sign-up, recovery) detect the language before the session exists.
  - *Done when:* every screen is translated in both languages, there are no hard-coded strings (lint rule) and CI fails if `es` is missing a key that exists in `en`.
- **OS-202 · Responsive layout** (M) · depends on OS-201
  - Desktop with a sidebar and two columns. Mobile with a top bar and a bottom tab bar (Feed · Search · Sync · Stats · You). Styled scrollbars and mobile safe areas.
- **OS-214 · Theme system** (M) · depends on OS-201
  - Design tokens in a single source file (JSON, in `packages/core`) that generates the CSS variables and the React Native app theme. Themes System, Light, Dark, OLED Black, High contrast, Forest, Ocean and Sunset. Picker with previews in Settings.
  - No flicker on load (inline script that applies the saved theme before painting), preference synced with the backend, and `prefers-color-scheme` and `prefers-contrast` respected.
  - Map (light or dark style) and charts adapted to each theme.
  - *Done when:* switching themes leaves no hard-coded colour visible and every theme passes WCAG AA contrast in CI.
- **OS-203 · Sign-in screen** (M) · depends on OS-110 and OS-201
  - Prototype design: on desktop, a brand panel on the left with the claim "Your sports data, on another level" (pointing at what the metrics and charts can show) and gentle animated waves (Canvas 2D, no library, still with `prefers-reduced-motion`), and the form on the right; on mobile, a single column. Links to "Create your account" (OS-221) and "Forgot it?" (OS-222).
  - Step 1: email and password (show/hide, "remember this device for 30 days"). Step 2: 6-digit TOTP code with auto-advance, pasting the whole code and a link to use a recovery code. "Continue with Google" (OS-220). "Sign in with a passkey" waits for OS-405 (backlog).
  - Clear errors that never reveal whether the email or the password was wrong, rate limiting with increasing delays and the right `autocomplete` values (`username`, `current-password`, `one-time-code`) for password managers.
  - **The sign-in screen shows no user data** (no numbers or routes): it is the only thing visible without a session.
  - Every route redirects to sign-in without a session. "Sign out" is in Settings and in the profile.
  - *Done when:* no data can be seen without a session (checked with end-to-end tests) and the password + TOTP flow works with a password manager.
- **OS-221 · Initial sign-up (first time)** (M) · depends on OS-110 and OS-203
  - Only exists while there is no account: one instance, one user. Sign-up closes afterwards.
  - Step 1: **setup code** + name, email and password (at least 12 characters, strength meter, check against breached passwords with Have I Been Pwned's *k-anonymity* API), and acceptance of how data is handled. Also "Sign up with Google" (OS-220).
  - **Setup code:** the server generates it on first boot and writes it to its Railway logs. Without it the account cannot be created, so nobody who finds the URL can register before you. It expires once used.
  - Step 2: enable TOTP with the QR code and the text key, verifying a code. Step 3: 8 recovery codes (copy or download), confirming they have been saved. Final: "All set" with next steps (connect Garmin, import Strava, theme and zones).
  - *Done when:* after the account is created, `/signup` returns "sign-up closed" and the setup code no longer works.
- **OS-222 · Password recovery** (M) · depends on OS-221
  - "Forgot it?" → email → the same message whether or not the account exists → single-use link that expires in 30 minutes → new password **plus the TOTP code or a recovery code** (someone with access only to your email cannot get in) → all other sessions are closed and a notification email is sent.
  - Random 32-byte token stored only as a hash, rate limiting per IP and per account, and resend at most every 60 s.
  - Transactional email with **Resend** (the free tier is enough), each instance with its own Resend account. Without a custom domain, Resend's test sender only delivers to the account owner's address, which is exactly the single user of the instance; a verified domain (SPF and DKIM) is optional. Emails in the user's language.
  - Plan B if everything is lost: the server command `opensport reset-password`.
- **OS-220 · Sign-in with a Google account** (M) · depends on OS-110 and OS-203
  - "Continue with Google" with OpenID Connect (authorization code flow with PKCE and `state`/`nonce`), requesting only `openid email profile`. The backend validates the ID token (issuer, audience, expiry, `email_verified`) and compares it with the linked Google `sub`: **only your account can get in**, even though other people have Google accounts.
  - Linked and unlinked from Profile → Account and sources → Sign-in methods. Unlinking requires another active method (password with 2FA or passkey).
  - Signing in with Google does not ask for the TOTP code: it counts as strong verification because Google already applies its own two-step verification.
  - Same Google Cloud project as the Google Health API (OS-603), but with its own OAuth client and no health scopes.
  - Self-hosted: each instance creates its own OAuth client in Google Cloud, with its `*.vercel.app` URL as the redirect (steps in OS-224).
  - *Note:* Google requires fixed redirect URLs. It works in production and locally, but not on Vercel previews (changing URLs), where you sign in with a password.
  - *Done when:* signing in with your Google account works and any other account gets a generic rejection.
- **OS-204 · Feed** (M) · depends on OS-111 and OS-202
  - Sport chips, cards with a route thumbnail, list grouped by month with its totals, and infinite scroll.
- **OS-217 · "Your week" header and highlights** (M) · depends on OS-204
  - **On the home screen, above the feed:** the 7 days of the week (activity with the sport icon, today marked, future days), streak of consecutive weeks and the week's numbers (activities, km, time, effort). Home only has this, the sport chips, the feed grouped by month and a link to advanced search.
  - **In Stats, "Now" section:** highlights carousel with training status and the last-4-weeks bar, weekly load vs your average, weekly goal with projection, estimated VO₂max and FTP, and recent records. Cards that depend on the engine (phase 3) appear when their data exists.
- **OS-219 · Advanced search screen** (L) · depends on OS-204
  - Its own "Search" section (sidebar on desktop and a tab on mobile). Home has no advanced filters, only a link to this screen.
  - Search by name, description or place. Filters: sports (several at once), period (year, month, last 12 months or date range), distance, duration, minimum elevation, average HR, gear, "with record", "with description", "with GPS track" and source (Garmin or Strava). Active filters appear as chips that can be removed with one tap.
  - Sort by date, distance, duration, elevation, effort or speed. Results summary (activities, km, hours, elevation). Table on desktop and cards on mobile, paginated.
  - On mobile, filters open in a bottom sheet with a "Show N results" button.
  - In the API: `GET /api/activities/search` with every filter, sorting and a cursor; indexes on date, sport and distance, and Postgres full-text search (`simple` + `unaccent`, valid for English and Spanish names). The search state lives in the URL so it can be shared and navigated back to.
  - *Done when:* any filter combination over 1,800+ activities responds in under 200 ms and the URL keeps the search.
- **OS-218 · Profile screen** (M) · depends on OS-203 and OS-111
  - Header with avatar, name, location, streak and device. The year's numbers. Tabs: Summary (year by sport, all-time history, records, physical data), Goals, Estimates (with their explanation and source activity), Gear, Account and sources (Garmin, Google Health, import, export, sign-in methods, sessions).
  - Edit profile (name, location, date of birth, sex, weight, height). On mobile it is the "You" tab and gives access to Settings.
- **OS-205 · Activity detail: header and numbers** (S) · depends on OS-204
- **OS-206 · Route map** (M) · depends on OS-205
  - MapLibre with our own style. Colour by pace, HR, power or altitude. Start and finish. Fallback without WebGL.
- **OS-215 · Chart foundation** (M) · depends on OS-214
  - ECharts with a theme generated from the tokens of each OpenSport theme. Our own SVG components for static charts (route thumbnail, sparklines, zone bar). Animations that respect `prefers-reduced-motion`, lazy loading off-screen and accessible summaries.
  - *Done when:* there is a component catalogue with an example of each kind (static, passive and active) in every theme.
- **OS-207 · Profile and charts synced with the map** (M) · depends on OS-206 and OS-215
- **OS-216 · Select a section on the profile** (S) · depends on OS-207
  - Drag over the profile to pick a section: shows its distance, time, pace, HR and elevation, and highlights it on the map.
- **OS-208 · Laps, best efforts and zones in the detail** (S) · depends on OS-205
- **OS-209 · Sync button with progress** (S) · depends on OS-112 and OS-202
  - Progress sheet polling every 2 s. The feed refreshes when it finishes.
- **OS-210 · Installable PWA** (S) · depends on OS-201
  - Manifest, icons and splash screen with `vite-plugin-pwa`.
- **OS-211 · Offline mode** (M) · depends on OS-210 and OS-204
  - Service worker for the app, IndexedDB for viewed activities and their streams, map tile cache and an "offline" notice.
- **OS-212 · Basic settings** (S) · depends on OS-203
  - Language, units, max/resting HR, Garmin key status and expiry, devices with an open session.
- **OS-213 · Quality** (M) · depends on OS-204…OS-209
  - End-to-end tests (Playwright) of the main flows in both languages, Lighthouse on mobile (≥ 90 for performance and PWA) and basic accessibility.
- **OS-225 · Strength training detail** (M) · depends on OS-105 and OS-205
  - The parser reads Garmin's set data from the FIT (exercise, reps, weight, duration and rest per set). The detail shows sets grouped by exercise, total volume (reps × weight) and a front/back body map with the muscle groups worked, as in the prototype's strength screen.
  - *Done when:* the anonymised strength fixture shows the same sets, reps and weights as Garmin Connect.
- **OS-224 · Self-hosting kit** (M) · depends on OS-005, OS-006 and OS-009
  - A production `docker compose` (API, worker, Postgres, volume and the built PWA behind one origin) for your own server, and a **"Deploy on Railway" template** plus Vercel instructions for the cloud path.
  - `docs/self-hosting.md`, step by step and in English: getting your own Garmin Personal API key, creating the Google OAuth client (OS-220), Resend, and later the Google Health client (OS-603) and the optional Anthropic key (OS-701). Every variable in `.env.example` is explained there.
  - Updates: how to upgrade an instance (migrations run on start) and how to back it up and restore it (OS-114).
  - *Done when:* someone other than you deploys a working instance from the guide alone, without help, in under an hour.

**M2 is done when** you open the installed PWA on your phone, see today's activity with its map, everything you have already viewed works without coverage, the whole app can be switched between English and Spanish, and another person can deploy their own instance with the self-hosting guide.

## Phase 3 · Advanced metrics → **M3**

**Goal:** the "Premium" metrics, computed with your settings and free for everyone. The algorithms are implemented in `packages/metrics` (MIT), tested against reference values and documented one by one (formula, inputs and limits), so the package is useful on its own. The **historical computation engine** "cooks" the whole history in the background: estimates, curves, progress and events (see [architecture.md](architecture.md#historical-computation-engine-cooking-the-data)).

- **OS-313 · Incremental computation engine** (L) · depends on OS-115 and OS-107
  - Importing an activity chains its metrics, the affected days, the curves, the estimates and the progress, recomputing only what depends on it. Computed tables carry `metrics_version`.
  - *Done when:* a new activity updates fitness, records and estimates in under 30 s, and no screen computes anything when it opens.
- **OS-314 · Full recomputation and versioning** (M) · depends on OS-313
  - When settings (HR, zones, FTP) or an algorithm version change, everything is reprocessed from the original FITs in the background, with progress visible in the app. Idempotent.
- **OS-301 · Configurable zone model** (M) · depends on OS-212
  - HR (% of max, reserve or threshold), pace and power (FTP). Changing it recomputes the whole history in the background.
- **OS-302 · Relative effort (TRIMP)** (S) · depends on OS-301
- **OS-303 · Fitness, fatigue and form (CTL/ATL/TSB)** (M) · depends on OS-302 and OS-313
  - `daily_load` table with incremental recomputation and the `GET /api/stats/fitness` API.
- **OS-304 · Personal records and their progression** (M) · depends on OS-107
  - All-time and per-season records, and a "🏆 record" notice on import.
- **OS-305 · Grade-adjusted pace (GAP)** (M) · depends on OS-105
  - Minetti model with smoothed barometric altitude.
- **OS-306 · Power curve** (S) · depends on OS-105
  - Per activity and all-time (rides and ROUVY).
- **OS-307 · Race prediction** (S) · depends on OS-304
- **OS-308 · Volume and trends** (S) · depends on OS-111
  - Per day, week, month and year, and per sport, precomputed by the engine to respond instantly with years of history.
- **OS-309 · Matched routes** (L) · depends on OS-106
  - Group activities by route similarity and compare times.
- **OS-310 · Personal heatmap** (M) · depends on OS-106
- **OS-311 · Stats screen** (M) · depends on OS-303…OS-308 and OS-320
  - "Now" highlights, fitness, volume, records, prediction and power curve, as in the prototype.
- **OS-312 · New metrics in the activity detail** (S) · depends on OS-302, OS-305 and OS-306
- **OS-315 · Best-effort curves per period** (M) · depends on OS-313
  - Pace, power and HR for durations from 5 s to 2 h, over 42 days, 90 days, season and all time.
- **OS-316 · Performance estimates** (L) · depends on OS-315
  - Estimated FTP, threshold and critical pace, threshold HR (LTHR), observed max HR, VO₂max (VDOT) and predictions from 5K to marathon. Each one with method, confidence and source activities, so the app can explain where it comes from ("from your best 20 min on 12 October").
  - *Done when:* the estimates are validated against your real data (for example, FTP vs the ROUVY power curve) and recompute on their own.
- **OS-317 · Progress and comparisons** (M) · depends on OS-313
  - Comparison with the same period last year, trend of each estimate, aerobic efficiency (pace at equal HR), decoupling and matched routes getting faster.
- **OS-318 · Goals and streaks** (M) · depends on OS-313 and OS-218
  - Km or hours goals per week, month or year, with an end-of-period projection and streaks of active weeks.
- **OS-319 · Engine events** (S) · depends on OS-313
  - "New record", "your estimated FTP is up", "high load ramp". Consumed by notifications (OS-401) and the AI (phase 7).
- **OS-321 · Stats by period** (M) · depends on OS-308 and OS-219
  - A period selector (all time, last 12 months, year, month) that applies to the whole screen: summary compared with the same period last year, fitness and freshness for the period, volume by year, month or day (in hours or km), best efforts of the period vs all-time records, and the period's power curve over the all-time one.
  - `GET /api/stats/*?from=&to=` endpoints served from the engine's precomputed tables (OS-313).
- **OS-322 · Year-over-year progress** (S) · depends on OS-321
  - Cumulative distance per day of the year, one line per year (the selected one highlighted), per sport. Hovering compares every year on the same date.
- **OS-323 · Validation against Strava's values** (M) · depends on OS-406, OS-302, OS-303, OS-305 and OS-324
  - The Strava export's `activities.csv` carries Strava's own Relative Effort, calories and grade-adjusted distance for every activity (stored as references by OS-406). The engine compares them with ours: correlation (R²), mean absolute error, a scatter chart and the activities that differ the most, with links to them.
  - Shown in Stats → "How these metrics compare", for anyone who imported a Strava export. Each metric keeps its own documented formula (TRIMP, Minetti, Keytel): the comparison measures how close they are, it does not train a model to imitate Strava.
  - Optional "Strava-like effort scale": a linear fit of minutes per HR zone against the imported Relative Effort, computed in each instance from that person's own data, with the coefficients visible. Nothing trained on one person's data ships with the code.
  - For development, `tools/metrics_benchmark` runs `packages/metrics` over a local Strava export and prints only aggregate numbers. Its output is never committed; CI keeps using the anonymised fixtures (OS-010).
  - *Done when:* on the real history, best efforts match exactly, grade-adjusted distance reaches R² ≥ 0.98, effort and calories have their R² and error measured and shown, and every number in the screen links to the activities behind it.
- **OS-324 · Calorie estimate** (S) · depends on OS-301
  - Keytel's formula (from HR, weight, age and sex) with a MET-based fallback when there is no HR, in `packages/metrics`. Used for activities without device calories (GPX, TCX, old imports); the device's value from the FIT always wins.
- **OS-325 · Personal segments** (L) · depends on OS-216 and OS-309
  - Save any stretch selected on an activity's profile (OS-216) as a segment with a name. The engine finds it in every past and future activity that goes through it (route matching on the simplified track, then exact start and end on the streams) and stores each effort.
  - Segment screen: map, elevation profile, your efforts over time with the trend, your best and the conditions of each attempt (HR, power, date). On the activity detail, the segments it went through and how it compared with your best. No leaderboards: only your own efforts.
  - *Done when:* a segment created from one activity is found in the rest of the history in the background, and a new activity through it shows its time and position among your efforts.
- **OS-326 · Training calendar** (M) · depends on OS-303 and OS-308
  - Week and month views with one bubble per activity sized by its load and coloured by sport, weekly totals in the margin and the form (TSB) for each day. Click → activity; drag across days → summary of the selection.
- **OS-320 · Dynamic stats charts** (L) · depends on OS-215, OS-315 and OS-316
  - Following the catalogue in [architecture.md](architecture.md#charts): fitness and freshness (animated on load and after a sync, per-day cursor, click → activities), volume with period transitions, best-effort curves comparing periods, progression of records and estimates, animated goals.

**M3 is done when** the stats screen shows today's fitness and form, your estimates (FTP, threshold pace, predictions) with their explanation and your progress, all precomputed and updated automatically after each activity.

## Phase 4 · Notifications, history and privacy → **M4**

**Goal:** not missing anything from Strava.

- **OS-401 · Web notifications** (M) · depends on OS-210 and OS-108
  - VAPID keys, per-device subscription and alerts for new activity, record and sync error, in the user's language.
- **OS-402 · Notification preferences** (S) · depends on OS-401
- **OS-403 · Garmin key expiry warning** (S) · depends on OS-401
  - Notification 14 days before and a warning in settings.
- **OS-404 · FIT and ZIP importer** (M) · depends on OS-106
  - Upload of loose FITs and Garmin ZIPs. Deduplication by start time and device.
- **OS-406 · Strava ZIP import** (M) · depends on OS-404
  - Tested with the real export: 1,816 activities (2011–2026), 1,635 FIT, 127 TCX and 53 GPX files, compressed or not. Reads `activities.csv` (104 columns, UTC times) and decompresses files on the fly. Strava's TCX files have whitespace before the XML declaration, which has to be stripped.
  - Deduplicates against Garmin by start time (±2 min): Garmin's FIT wins, and the name, description, gear, photos and weather are kept from Strava. Also imports what exists only on Strava (for example, strength sessions recorded with another app).
  - Smoothed distance and elevation for GPX and TCX. No best efforts from GPX-only distance. Strava's Relative Effort and grade-adjusted distance are stored as references to validate our metrics.
- **OS-407 · Server-side privacy zones** (M) · depends on OS-111
  - Trim when serving and exporting anything shareable, configured in settings.
- **OS-408 · Share an activity** (M) · depends on OS-407
  - Signed, expiring link, or an image. Privacy applied.
- **OS-409 · Edit an activity** (S) · depends on OS-111
  - Name, description, type and gear. The original FIT is never touched.
- **OS-410 · Gear and mileage** (S) · depends on OS-409 and OS-406
  - Shoes and bikes, with a mileage warning. Preloaded from `bikes.csv`, `shoes.csv` and the gear on each activity in the Strava export.
- **OS-411 · Export all your data** (S) · depends on OS-104
  - ZIP with the original FITs and JSON.
- **OS-412 · Photos in activities** (S) · depends on OS-406 and OS-205
  - The photos from the Strava export are stored next to their activity on the volume; you can also add or remove photos. Gallery in the detail and a thumbnail on the feed card. EXIF location is removed before anything is shared.
- **OS-413 · Year and month in review** (M) · depends on OS-321 and OS-408
  - A recap of each month and each year: totals, records, longest and hardest activities, most-used gear and progress against the previous period, as a sequence of cards. Each card can be shared as an image, with privacy zones applied and no route unless you choose to.
- **OS-414 · Activity replay** (S) · depends on OS-207
  - Animated 2D playback of the route on the map with the cursor moving along the profile and the charts, at 10×–100× speed, with pause and seeking. Respects `prefers-reduced-motion`.

**M4 is done when** your whole history is in OpenSport, notifications reach you and you can share an activity without revealing where you live.

## Phase 5 · Android app (React Native + Expo) → **M5**

**Goal:** a better mobile experience (background, reliable notifications, Health Connect, widget) reusing `packages/core`.

The performance proof of concept (OS-501) runs at the start of phase 2. This phase assumes React Native won; if Kotlin did, it is re-planned.

- **OS-502 · Expo project in the monorepo** (M) · depends on OS-501
  - `apps/mobile` with Expo Router, the new architecture and Hermes. EAS Build and EAS Update. CI with lint, tests and build. Theme generated from the `packages/core` tokens (OS-214), plus Android dynamic colour. i18n with the shared catalogues and `expo-localization`.
- **OS-503 · Authentication in the app** (L) · depends on OS-502, OS-110 and OS-220
  - **First sign-in**, with two options now and a third when OS-405 leaves the backlog:
    - **Native Google** with `@react-native-google-signin/google-signin` (Android Credential Manager: one-tap account sheet). The app sends the ID token to `POST /api/auth/google/mobile` and the backend applies the same linked-account-only rule.
    - **Password + TOTP.**
    - *Later:* **passkey** with `react-native-passkey`, the same one as the PWA, thanks to the `assetlinks.json` published on the instance's URL.
  - **Day to day with the fingerprint:** the refresh token is stored in `expo-secure-store` with `requireAuthentication`, bound to Android's secure keystore and released only after biometric verification (`expo-local-authentication`). Opening the app means touching the sensor.
  - **Strong biometrics by default** (class 3). On many Samsung phones face recognition is weak (class 1/2) and cannot release keys, so the fingerprint is used there. A setting allows weak biometrics only as an app lock.
  - If the enrolled fingerprints change, there are several failures or the token expires, Google or the password is required again.
  - Setup: an Android OAuth client in Google Cloud with the package name and the SHA-1 fingerprints of the EAS and Play Store certificates.
  - Self-hosted: on first launch the app asks for the instance URL (your `*.vercel.app` or your own server), so one published app works with any instance.
  - *Done when:* on your S26 you sign in the first time with Google and afterwards open the app with just your fingerprint, and an unlinked Google account is rejected.
- **OS-504 · Feed, "Your week" header and detail** (L) · depends on OS-503
  - Parity with the PWA using the `packages/core` hooks. FlashList, native MapLibre and Skia charts.
- **OS-505 · Offline mode** (M) · depends on OS-504
  - TanStack Query's persistent cache and `expo-sqlite` for streams.
- **OS-506 · Background sync** (S) · depends on OS-505
  - `expo-background-task` (WorkManager underneath).
- **OS-507 · Notifications with FCM** (M) · depends on OS-401 and OS-503
  - `expo-notifications`. On the backend, sending through FCM in addition to Web Push.
- **OS-508 · Stats, search and profile** (M) · depends on OS-311, OS-219, OS-218 and OS-504
- **OS-509 · Home-screen widget** (M) · depends on OS-505
  - Latest activity and today's form, with `react-native-android-widget` or an Expo module in Kotlin.
- **OS-510 · Play Store internal testing release** (S) · depends on OS-504…OS-507
  - With EAS Submit.

**M5 is done when** the Android app replaces the PWA on your phone, with reliable notifications and background sync.

## Phase 6 · Multi-source health → **M6**

**Goal:** sleep, HRV, resting HR and daily data from all your sources in a single model, without duplicates.

- **OS-601 · Health data model** (M) · depends on OS-102
  - Tables `sleep_sessions` (stages), `daily_health` (resting HR, HRV, SpO₂, respiration, steps), `sources` and `source_priority`. Every data point stores its source and its `external_id`.
- **OS-602 · Garmin: sleep, HRV and daily data from the Personal API** (M) · depends on OS-601 and OS-103
- **OS-603 · Google Health API connector (Fitbit Air)** (L) · depends on OS-601
  - Google OAuth 2.0 with minimal read-only scopes (sleep, HR, HRV, SpO₂, activity). Tokens encrypted in the database. Incremental sync.
  - Self-hosted: each instance uses its own OAuth client, added to the self-hosting guide (OS-224).
  - *Note:* a Google OAuth app in "Testing" mode issues refresh tokens that expire after 7 days. It has to be checked whether that is acceptable for personal use (re-authorising every week) or whether Google's verification for health scopes is needed.
- **OS-604 · Google Health webhooks** (M) · depends on OS-603
  - Endpoint on Railway that receives new-data notifications, with signature verification. The cron remains as a fallback.
- **OS-605 · Priority rules and deduplication between sources** (M) · depends on OS-602 and OS-603
  - Examples: sleep → Fitbit Air if you wore it that night; activities → Garmin; resting HR → the source with the most hours of data. Configurable in settings.
- **OS-606 · Health dashboard** (M) · depends on OS-605
  - Trends of sleep (stages and score), HRV, resting HR and "readiness" combined with the form (TSB) from phase 3.
- **OS-607 · Reading Health Connect from the Android app** (M) · depends on OS-502
  - With `react-native-health-connect`.
  - A local alternative to Google's API for the native app.
- **OS-608 · Import from the watch over USB** with a desktop tool or a local script (S)
- **OS-609 · Evaluate offline map downloads** for routes (M)
- **OS-610 · Evaluate recording activities with the phone's GPS** on Android (L)

**M6 is done when** the health dashboard shows last night's sleep and HRV, even when they come from different devices, without duplicates.

## Phase 7 · AI assistant → **M7**

**Goal:** OpenSport explains your data in natural language, with a small and cheap LLM via API, without sending more data than necessary.

It can start as soon as M3 is done (it needs the metrics), in parallel with phases 4 to 6.

- **OS-701 · LLM client in the backend** (S) · depends on OS-101
  - Official `anthropic` SDK with `claude-haiku-5-5`. Each instance brings its own key in the Railway variables; **without a key, every AI feature is hidden** and the rest of the app works the same. Retries and typed errors. Token and cost logging per call in the `llm_calls` table.
- **OS-702 · Data minimisation** (M) · depends on OS-701
  - A layer that builds the LLM context **without coordinates or profile data**: only aggregated numbers (distance, times, zones, TRIMP, fitness, records, sleep). With tests that guarantee no latitude or longitude ever leaves.
- **OS-703 · Automatic summary of each activity** (M) · depends on OS-702 and OS-304
  - 2–3 sentences on import, in the user's language: what it was, how it compared with usual and any record. With structured output (`output_config.format`): `{suggested_title, summary, highlights[]}`. Can be turned off.
- **OS-704 · Weekly report** (M) · depends on OS-703 and OS-303
  - Every Monday: volume, load, fitness and form, sleep and a recommendation. Generated in batch (Batch API, half price) and sent as a notification.
- **OS-705 · "Coach": natural-language questions** (L) · depends on OS-702
  - Chat in the PWA. The model does not receive the whole history: it uses **tools** that call our own API (`search_activities`, `fitness_stats`, `records`, `daily_health`) and answers with numbers and links to activities. Streamed responses.
- **OS-706 · Prompt caching and cost control** (S) · depends on OS-705
  - Stable, cached system prompt and tool definitions. Monthly spending cap with a warning. Measure `cache_read_input_tokens`.
- **OS-707 · Quality evaluation** (M) · depends on OS-703 and OS-705
  - A set of 30–50 real activities and questions with expected answers, in both languages. It checks that the quoted numbers match the database (nothing invented). Run before changing the prompt or the model.
- **OS-708 · Privacy and transparency** (S) · depends on OS-702
  - A global "use AI" switch in settings, an explanation of what data is sent, and nothing stored with the provider that is not needed.
- **OS-709 · Read-only MCP server** (S) · depends on OS-705 and OS-702
  - Exposes the Coach's tools (`search_activities`, `fitness_stats`, `records`, `daily_health`) as an MCP server so you can ask any AI assistant about your data. Read-only, behind a personal token created in Settings and revocable, with the same minimisation as OS-702 (no coordinates).
  - Works without an Anthropic key: the assistant you use brings its own model.

**M7 is done when** every new activity arrives with its summary, the weekly report arrives on Monday and the Coach answers questions like "how am I doing for a 10K?" with correct numbers.

---

## Backlog

Not planned in any phase. Each one comes back when its reason to wait goes away.

- **OS-D06 · Choose the production domain** (S)
  - Waits until there is a reason for a brand or a hosted version. Each instance uses its `*.vercel.app` URL meanwhile.
  - Would be needed by: passkeys shared with the Android app under a single domain, a custom sender in Resend and nicer Google OAuth URLs.
- **OS-405 · Passkeys (WebAuthn)** (M) · depends on OS-110
  - Passkey registration and sign-in on the PWA (verified with the device's fingerprint or face recognition), synced by the password manager (Google or iCloud). Managed in Profile → Sign-in methods.
  - The relying party ID is the instance's URL, which must stay stable (changing it invalidates every passkey). A stable `*.vercel.app` subdomain works, and `/.well-known/assetlinks.json` would let **the same passkey work in the Android app** (OS-503).
  - Waits because Google sign-in and the fingerprint in the app already cover convenient access.
- **Route builder and sending routes to the watch** (L)
  - Draw a route on the map with elevation and surface, save it and export it as GPX or FIT course. Sending it straight to the watch depends on whether the Garmin Personal API accepts uploads; to be checked.
- **Structured workouts and training plans** (L)
  - Interval workouts by pace, HR or power, and multi-week plans built on the engine's estimates. Same open question about sending them to the watch.
- **3D route view** (M)
  - MapLibre with terrain elevation for the activity and replay (OS-414).
- **Error tracking with Sentry** (S)
  - Backend (FastAPI) and web (React) SDKs with data scrubbing and no IP addresses, in its own Sentry organisation (EU region). Comes back when structured logs and the sync-failure alert (OS-114) are no longer enough, for example once other people run their own instances.
- **Brand: apply the Zankup mark and icons** (#116)
  - Name, mark and wordmark are decided (see the [brand guide](brand/README.md)). What remains is implementation: the mark as a single source of truth in `packages/core`, PWA icons and manifest, Expo adaptive icon and splash, and removing the traced mountain mark from the prototypes. The product rename is a separate task (guide, section 7.2) that waits for the domain and trademark checks.

## Recommended starting order

1. **OS-D07 → OS-D08** (owner decisions), **OS-007** (rotate the key), then **OS-001**, **OS-002/OS-003**, **OS-008 → OS-010** and **OS-004 → OS-006** (foundations).
2. **OS-101 → OS-109**: the critical path for M1, testable without a UI.
3. **OS-501**: the React Native proof of concept, as soon as M1 serves real data.
4. **OS-110 → OS-112**, in parallel with **OS-201 → OS-202** and **OS-223** (web and i18n from the start).
5. The rest of phase 2 in number order, ending with **OS-224** (self-hosting kit).

## External dependencies and risks by phase

| Phase | Risk | Mitigation |
|---|---|---|
| All | The Garmin Personal API is for personal use only | Self-hosting with each person's own key: no shared key, no central service |
| 1 | Unpublished Personal API limits | Incremental sync, pauses and retries on 429. Measure in production |
| 1 | The key expires (1 year at most) | OS-403 and the date visible in settings (OS-212) |
| 2 | Vercel proxy limits | Poll progress every 2 s and paginate. Plan B: an `api.` subdomain |
| 2 | WebGL not available | Leaflet fallback, already tested in the prototype |
| 2 | Untranslated texts creeping in | Lint rule against hard-coded strings and a CI check for missing `es` keys (OS-223) |
| 2 | React Native performance on the activity detail | Proof of concept OS-501 with measurable criteria, before the PWA and the rest of the app |
| 2 | Self-hosting too hard for other people | Railway template, Docker Compose and a guide tested by someone else (OS-224) |
| 4 | Web Push on iOS only with the PWA installed | Document it. The phase 5 app is Android, but with Expo it could ship on iOS later |
| 5 | Play Store policy and health data | Internal testing and a sensitive data declaration |
| 6 | 7-day Google OAuth tokens in "Testing" mode and health scope verification | Test it first in OS-603. If not viable: Health Connect from Android (OS-607) |
| 6 | Duplicated or contradictory data between Garmin and the Fitbit Air | Configurable priority rules (OS-605) and the source always visible |
| 7 | The LLM invents numbers | Tools that return real data, evaluation with number checks (OS-707) |
| 7 | Health data sent to a third party | Minimisation (OS-702), no coordinates, global switch (OS-708) |
