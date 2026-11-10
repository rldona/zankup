# apps/mobile

The Android app (phase 5): React Native with Expo (SDK 58, new architecture, Hermes), Expo Router and
`packages/core` for the API client, queries, formatting, tokens and translations. The architecture and
the decision behind it are in [docs/architecture.md](../../docs/architecture.md#android-app-phase-5-react-native--expo).

|                                                                                                                                                                                                                                                                                                                                  | Where                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Sign-in: instance URL, Google (native sheet), password + TOTP; fingerprint afterwards                                                                                                                                                                                                                                            | `src/session.ts`, `src/SignIn.tsx`                                                                                         |
| Feed with "This week", detail (map coloured by metric, replay, profile with cursor and sections, zones, laps, power, strength, editing, photos), stats, search, sync, you (editable profile, goals, estimates, account), settings by section (zones, notifications, MCP tokens, privacy zones, health sources, export, sessions) | `app/`, `src/`                                                                                                             |
| Stats with every section of the PWA, calendar, heatmap, routes, segments, month/year review                                                                                                                                                                                                                                      | `app/(tabs)/stats.tsx`, `src/stats/`, `app/calendar.tsx`, `app/heatmap.tsx`, `app/routes/`, `app/segments/`, `app/review/` |
| Health (sleep, readiness, trends drawn with Skia), gear, import (files picked on the phone, uploaded in parts)                                                                                                                                                                                                                   | `app/health.tsx`, `app/gear.tsx`, `app/import.tsx`, `src/charts.tsx`, `src/upload.ts`                                      |
| Offline: query cache and series in SQLite                                                                                                                                                                                                                                                                                        | `src/offline.ts`                                                                                                           |
| Background sync (WorkManager)                                                                                                                                                                                                                                                                                                    | `src/background.ts`                                                                                                        |
| Notifications (FCM)                                                                                                                                                                                                                                                                                                              | `src/push.ts`; the API sends them (`backend/src/zankup/notify.py`)                                                         |
| Home-screen widget                                                                                                                                                                                                                                                                                                               | `src/widget/`                                                                                                              |
| Wordmark: ZANKUP as one path from `packages/core`, drawn with Skia (sign-in, lock screen)                                                                                                                                                                                                                                        | `src/Wordmark.tsx`                                                                                                         |
| AI assistant (phase 7): the summary of an activity, the switches in Settings, the weekly report and the Coach (streamed with `expo/fetch`)                                                                                                                                                                                       | `src/Ai.tsx`, `app/coach.tsx`, `src/coach.ts`                                                                              |

## Two apps on the phone: Zankup and Zankup Dev

The phone has two apps side by side, so there is always one that needs no computer:

- **Zankup** (`com.zankup.app`), the release build: the JavaScript is inside, it works anywhere, and it
  has push notifications.
- **Zankup Dev** (`com.zankup.app.dev`, built with `ZANKUP_DEV=1`): the JavaScript is served by Metro
  from this computer, with Fast Refresh. It only opens while Metro is running and the phone can reach
  it. It has no push notifications (the Firebase project only knows `com.zankup.app`), allows plain
  HTTP for a local API, and keeps its own session and Health Connect permissions.

```bash
pnpm release:android   # the everyday app: builds the release and installs it over the previous one
pnpm dev:android       # Zankup Dev, first time or after a native change: builds it, installs it, starts Metro
pnpm dev               # afterwards: only Metro (and the adb reverse of the API and Metro ports)
```

Both scripts regenerate `android/` (not committed) for their own app, so the first Gradle build after
switching from one to the other takes longer. Saving a file shows the change in Zankup Dev in a second
or two, keeping the screen you are on. Only native changes need `pnpm dev:android` again: a new native
library, `modules/`, `plugins/`, icons, splash or `app.config.ts`.

If Zankup Dev stays on the splash screen, it cannot reach Metro: start it (`pnpm dev`), and after `adb`
over Wi-Fi reconnects, run `pnpm dev` again (it sets up `adb reverse` once more).

With a local API (`make api`), use `http://localhost:8000` as the server in Zankup Dev.

Release builds are signed with the owner's own key when
`~/.config/zankup/android/signing.properties` exists (or the file `ZANKUP_SIGNING` points at), with
`storeFile`, `storePassword`, `keyAlias` and `keyPassword`. It is never committed and must be backed up:
passkeys (`apps/web/public/.well-known/assetlinks.json`) and Google sign-in trust the app by that key,
and Android only updates an installed app signed with the same one. Without the file, release builds
keep the public debug key and passkeys do not work.

## What needs an account (not in the repository)

- **Notifications:** a Firebase project with an Android app `com.zankup.app`. Its `google-services.json`
  goes in this folder before building; its service account key (JSON) goes in the API's
  `FCM_SERVICE_ACCOUNT` variable.
- **Google sign-in:** an _Android_ OAuth client in the instance's Google Cloud project, with the package
  `com.zankup.app` and the SHA-1 of the signing certificate (`keytool -list -v` on the release key
  above, or `eas credentials`); a second one with `com.zankup.app.dev` for Google in Zankup Dev. The app
  asks for ID tokens for the instance's existing _web_ client.
- **Passkeys:** the API's `WEBAUTHN_ORIGINS` must include `android:apk-key-hash:<base64url SHA-256 of
the signing certificate>`, and `assetlinks.json` must list the same SHA-256 (for both packages).
- **Play Store (internal testing):** parked for now (OS-510); builds are installed straight on a phone as
  above. When it comes back: an Expo account (`eas build -p android --profile production`) and a Google
  Play service account in `play-service-account.json` for `eas submit -p android`.
