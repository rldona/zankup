# Self-hosting Zankup

Zankup is one person's sports and health data, together, on their own instance. This guide takes you from nothing to a
working instance with your Garmin history, in under an hour. There are two ways:

- **Your own server** (a VPS, a home server, a Raspberry Pi 4/5 with 4 GB): one `docker compose`
  with Postgres, the API and the web app behind one origin, with automatic HTTPS.
- **The cloud**: the API on [Railway](https://railway.com) and the web app on
  [Vercel](https://vercel.com), as the reference instance (zankup.com) runs.

Either way you need the same accounts and keys. Get them first.

## 1. What you need

| What | Needed? | Where |
| --- | --- | --- |
| Garmin Personal API key | Yes, for Garmin sync | Garmin Connect → Settings → [Personal API token](https://connect.garmin.com/app/settings/personalApiToken) |
| A domain or subdomain | Recommended (passkeys and Google sign-in need HTTPS) | Any registrar |
| Resend API key | Recommended (password recovery, sync alerts) | [resend.com/api-keys](https://resend.com/api-keys) |
| Google OAuth client | Optional ("Continue with Google") | [Google Cloud console](https://console.cloud.google.com/apis/credentials) |
| An S3-compatible bucket | Recommended (daily backups) | Railway bucket, Cloudflare R2, Backblaze B2… |

### Garmin Personal API key

1. Sign in to Garmin Connect on the web and open **Settings → Personal API token**.
2. Create a token and copy it: it is shown once. It is `GARMIN_PERSONAL_API_KEY`.
3. Note the expiry date Garmin shows and put it in `GARMIN_KEY_EXPIRES_ON` (YYYY-MM-DD): Settings
   shows it and warns you two weeks before.

### Resend (e-mail)

1. Create a free account at resend.com and an API key with "Sending access": `RESEND_API_KEY`.
2. Without a domain of your own, Resend's test sender (the default `ALERT_FROM`) only delivers to
   your Resend account's address. That is fine: set `ALERT_EMAIL` to it and use the same address for
   your Zankup account. With a verified domain (SPF and DKIM), set
   `ALERT_FROM="Zankup <alerts@your-domain>"`.

### Google sign-in (optional)

1. In Google Cloud, create a project (or use one), then **APIs & Services → OAuth consent screen**:
   External, with your e-mail as a test user. Only the `openid`, `email` and `profile` scopes.
2. **Credentials → Create credentials → OAuth client ID → Web application.**
   - Authorized redirect URI: `https://your.domain/api/auth/google/callback` (your own origin).
3. Copy the client ID and secret: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
4. After your first sign-in, link your Google account in Profile → Account. Only that account can
   sign in with Google; any other gets a generic rejection.

Google needs fixed redirect URLs, so it does not work on preview deployments.

### Google Health: Fitbit Air and other Google devices (optional)

Sleep with stages, HRV, resting heart rate, SpO₂, respiration and steps, read-only. It uses the same
OAuth client as Google sign-in.

1. In the same Google Cloud project, **APIs & Services → Library → Google Health API → Enable**.
2. **OAuth consent screen → Data access → Add or remove scopes**: add
   `…/auth/googlehealth.sleep.readonly`, `…/auth/googlehealth.health_metrics_and_measurements.readonly`
   and `…/auth/googlehealth.activity_and_fitness.readonly`.
3. In the OAuth client, add a second redirect URI: `https://your.domain/api/wellness/google/callback`.
4. Set `GOOGLE_HEALTH_ENABLED=true` and restart. **Settings → Health → Connect Google Health.**

While the app is in **Testing** mode, Google makes the refresh token expire after **7 days**: Zankup then
sends a notification and Settings shows **Connect again**. Publishing the app removes the limit, but
health scopes need Google's verification. The Android app's **Health Connect** reading avoids Google's
OAuth altogether, if the Google Health app on your phone writes there.

**Webhooks (optional).** Without them Zankup asks Google every hour; with them, minutes after the watch
syncs. Pick a long random secret, set it as `GOOGLE_HEALTH_WEBHOOK_SECRET`, restart, and create the
subscriber with your project **number** and a token of an account that owns the project:

```bash
curl -X POST "https://health.googleapis.com/v4/projects/PROJECT_NUMBER/subscribers?subscriberId=zankup" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "Content-Type: application/json" \
  -d '{"endpointUri": "https://api.your.domain/api/webhooks/google-health",
       "subscriberConfigs": [{"dataTypes": ["sleep", "daily-resting-heart-rate",
         "daily-heart-rate-variability", "daily-oxygen-saturation", "daily-respiratory-rate", "steps"],
         "subscriptionCreatePolicy": "AUTOMATIC"}],
       "endpointAuthorization": {"secret": "THE_SAME_SECRET"}}'
```

Google checks the endpoint right away (once with the secret, once without). Every notification is
also signed; Zankup verifies the signature with Google's published keys before queuing a sync.

### Garmin health data

With the Personal API key, Zankup also brings sleep, HRV (on watches that measure it), resting heart
rate, SpO₂, respiration and steps every hour. Nothing to set up.

## 2a. Your own server

Requirements: Docker with Compose, ports 80 and 443 open (for HTTPS), and a DNS `A` record from your
domain to the server.

```bash
git clone https://github.com/rldona/zankup.git && cd zankup
cp .env.example .env
```

Fill in `.env`:

- `POSTGRES_PASSWORD`: any long random string.
- `JWT_SECRET`: `openssl rand -base64 48`. Signs sessions and encrypts the TOTP keys: keep it
  safe and never change it (everyone would have to set up two-step verification again).
- `ZANKUP_SITE`: your domain, e.g. `sport.example.com`. Caddy gets the certificate on its own.
- `WEBAUTHN_RP_ID`: the same domain. `WEBAUTHN_ORIGINS`: `["https://sport.example.com"]`.
  Never change the RP ID once you have passkeys: every one of them stops working.
- `GARMIN_PERSONAL_API_KEY`, and the optional ones above.

Then:

```bash
docker compose -f deploy/compose.yaml up -d --build
docker compose -f deploy/compose.yaml logs api | grep "setup code"
```

Open `https://sport.example.com`: it goes straight to **Create your account**. The setup code is
in that log line (it is printed on every start until the account exists), so only whoever runs the
server can create the account. Pick a password, scan the QR code with your authenticator app, keep
the recovery codes, and on the last step press **Load my Garmin history**.

To try it on your own machine first, leave `ZANKUP_SITE=:8080` and open `http://localhost:8080`
(passkeys work on localhost; Google sign-in needs a real domain).

## 2b. Railway and Vercel

1. **Railway**: new project → **Deploy from GitHub repo** → your fork. Railway reads `railway.json`:
   it builds `backend/Dockerfile`, runs the migrations before each deploy and checks
   `/api/health`.
   - Add a **PostgreSQL** database and, on the API service, `DATABASE_URL=${{Postgres.DATABASE_URL}}`.
   - Add a **volume** mounted at `/data` and `DATA_DIR=/data` (the original FIT files).
   - Variables: everything from `.env.example` you use, plus `ENVIRONMENT=production`.
   - Optional: a **bucket** for backups, with the `BACKUP_S3_*` variables referencing it.
   - **Settings → Networking**: generate a domain, or add your own (e.g. `api.your.domain`).
2. **Vercel**: new project from the same repository, root directory `apps/web`. In
   `apps/web/vercel.json`, point the `/api/:path*` rewrite to your Railway URL. Add your domain.
   Only `main` deploys (no preview builds).
3. Set `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGINS` on Railway to the Vercel domain, and use
   `https://that-domain/api/auth/google/callback` as Google's redirect URI.
4. The setup code is in Railway → API service → Deployments → Logs.

## 3. Updating

Migrations run on every start, so updating is pulling and starting again:

```bash
git pull
docker compose -f deploy/compose.yaml up -d --build
```

On Railway and Vercel, a push to `main` deploys both.

## 4. Backups and restoring

With a bucket configured (`BACKUP_S3_*`) or a directory (`BACKUP_DIR`), Zankup dumps the database
and copies the original FIT files every day at `BACKUP_HOUR_UTC` (3:00 by default), keeps
`BACKUP_KEEP_DAYS` (30), and e-mails you if it fails. The FIT files are the source of truth:
everything else can be recomputed from them.

```bash
docker compose -f deploy/compose.yaml exec api python -m zankup.backup list
# Restore the latest dump (or --date YYYY-MM-DD) over this instance's database and files:
docker compose -f deploy/compose.yaml exec api sh -c \
  'python -m zankup.backup restore --database-url "$DATABASE_URL" --data-dir /data'
```

Restoring overwrites the database: on a fresh server, start the stack once, restore, then restart
the API.

## 5. If you get locked out

- Forgot the password: **Forgot it?** on the sign-in screen. You need the e-mail and a code from
  your authenticator app or a recovery code.
- Lost everything: from the server,
  `docker compose -f deploy/compose.yaml exec api python -m zankup.admin reset-password` (or, on
  Railway, through `railway ssh` with `/app/.venv/bin/python`). `enable-totp`, `sessions` and
  `sign-out-all` are there too.

## 6. Every variable

| Variable | What it does |
| --- | --- |
| `GARMIN_PERSONAL_API_KEY` | Garmin sync. Without it, Garmin is hidden. |
| `GARMIN_KEY_EXPIRES_ON` | The key's expiry date (YYYY-MM-DD), shown and warned in Settings. |
| `ENVIRONMENT` | `production` on a server (JSON logs, no API docs, secure cookies). |
| `LOG_LEVEL`, `LOG_FORMAT` | Logging: `INFO` and `json` in production. |
| `DATABASE_URL` | Postgres. The compose file sets it from `POSTGRES_PASSWORD`. |
| `DATA_DIR` | The volume (`/data`): original activity files, photos, uploads being imported, exports and the generated VAPID key. |
| `OWNER_EMAIL` | Placeholder account the sync uses before sign-up; sign-up takes it over. |
| `RUN_WORKER` | Run the background worker inside the API (`true`). |
| `SYNC_INTERVAL_MINUTES` | Automatic Garmin sync every N minutes (15); 0 turns it off. |
| `JWT_SECRET` | Signs sessions and encrypts TOTP keys and Google Health's token. Required; never change it. |
| `RESEND_API_KEY`, `ALERT_EMAIL`, `ALERT_FROM` | E-mail: password recovery and sync/backup alerts. |
| `BACKUP_S3_*`, `BACKUP_DIR`, `BACKUP_KEEP_DAYS`, `BACKUP_HOUR_UTC` | Daily backups. |
| `PG_DUMP_COMMAND`, `PG_RESTORE_COMMAND` | Backup tools; the image has the right ones. |
| `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGINS` | Your domain and origin, for passkeys, Google and e-mail links. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in (and Google Health, with the same client). |
| `GOOGLE_HEALTH_ENABLED` | `true` offers connecting Google Health in Settings → Health. |
| `GOOGLE_HEALTH_WEBHOOK_SECRET` | Google Health's new-data notifications (optional; the hourly sync works without). |
| `API_PUBLIC_URL` | The API's own public address (e.g. `https://api.example.com`) when the app reaches it through a proxy: imports and exports then go there directly. Leave it empty when the app and the API share an origin. |
| `FCM_SERVICE_ACCOUNT` | Notifications in the Android app: the Firebase service account key (the whole JSON). |
| `VAPID_PRIVATE_KEY` | Push notifications. Optional: without it a key is generated once and kept in `DATA_DIR`. |
| `ANTHROPIC_API_KEY` | AI features (phase 7): the summary of each activity, Monday's report and the Coach. Without it they stay hidden. |
| `AI_MODEL`, `AI_MONTHLY_BUDGET_USD`, `WEEKLY_REPORT_HOUR_UTC` | The model (default `claude-haiku-5-5`), the monthly spending cap (default 5 USD; AI features pause when it is reached) and the hour (UTC) Monday's report is queued. |
| `POSTGRES_PASSWORD`, `ZANKUP_SITE` | Only for `deploy/compose.yaml`. |
| `RAILWAY_API_TOKEN`, `VERCEL_TOKEN` | Only for scripting the cloud setup; never needed by the app. |
