# apps/mobile

The Android app (phase 5): React Native with Expo (SDK 58, new architecture, Hermes), Expo Router and
`packages/core` for the API client, queries, formatting, tokens and translations. The architecture and
the decision behind it are in [docs/architecture.md](../../docs/architecture.md#android-app-phase-5-react-native--expo).

|                                                                                                                     | Where                                                              |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Sign-in: instance URL, Google (native sheet), password + TOTP; fingerprint afterwards                               | `src/session.ts`, `src/SignIn.tsx`                                 |
| Feed with "This week", detail (map, profile with cursor and sections, photos, splits), stats, search, you, settings | `app/`, `src/`                                                     |
| Offline: query cache and series in SQLite                                                                           | `src/offline.ts`                                                   |
| Background sync (WorkManager)                                                                                       | `src/background.ts`                                                |
| Notifications (FCM)                                                                                                 | `src/push.ts`; the API sends them (`backend/src/zankup/notify.py`) |
| Home-screen widget                                                                                                  | `src/widget/`                                                      |
| Brand lock-up: the mark drawn with Skia from `packages/core`, the wordmark in the bundled Momo Trust Display        | `src/Lockup.tsx`, `assets/fonts/`                                  |

## Run it on the emulator or a phone

Needs the Android SDK (`ANDROID_HOME`) and the API running locally (`make api`).

```bash
adb reverse tcp:8000 tcp:8000                         # the phone reaches the local API as localhost:8000
ZANKUP_DEV=1 pnpm exec expo prebuild -p android        # android/ (not committed); ZANKUP_DEV allows http
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a   # x86_64 for the emulator
adb install -r app/build/outputs/apk/release/app-release.apk
```

On first launch use `http://localhost:8000` as the server.

## What needs an account (not in the repository)

- **Notifications:** a Firebase project with an Android app `com.zankup.app`. Its `google-services.json`
  goes in this folder before building; its service account key (JSON) goes in the API's
  `FCM_SERVICE_ACCOUNT` variable.
- **Google sign-in:** an _Android_ OAuth client in the instance's Google Cloud project, with the package
  `com.zankup.app` and the SHA-1 of the signing certificate (`eas credentials`, or the debug keystore's
  for local builds). The app asks for ID tokens for the instance's existing _web_ client.
- **Play Store (internal testing):** an Expo account (`eas build -p android --profile production`) and a
  Google Play service account in `play-service-account.json` for `eas submit -p android`.
