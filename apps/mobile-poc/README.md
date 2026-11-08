# Zankup React Native proof of concept (OS-501)

Only the activity detail, to decide React Native or Kotlin for the Android app before phase 5:
MapLibre map with the route, an elevation and heart-rate profile drawn with Skia, a cursor that follows
the finger (Reanimated, synced with the map) and section selection with its numbers. Real data from the
API, signed in like the Android app will be (password + TOTP, tokens in the Android keystore).

The result and the decision are in [docs/architecture.md](../../docs/architecture.md#android-app-phase-5-react-native--expo).
This folder is a throwaway: phase 5 starts the real app.

## Run it on a phone

Needs the Android SDK (`ANDROID_HOME`), a phone with USB or wireless debugging and the API running
locally with data (`make api`, then `make sync` or `make history`).

```bash
adb reverse tcp:8000 tcp:8000          # the phone reaches the local API as localhost:8000
pnpm exec expo prebuild -p android     # generates android/ (not committed)
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
adb install -r app/build/outputs/apk/release/app-release.apk
```

Sign in with an account of that instance (`python -m zankup.admin set-password` and `enable-totp`).
The app opens on the latest activity; "All" lists the others.

## Measure

```bash
scripts/measure.sh 10   # cold start ×10, frame rate while dragging the cursor, memory
```

The app logs its own numbers to logcat (`PERF …`): time to the detail with its map, frames per second on
the UI thread (Reanimated) and on the JS thread, and where the chart is so the script can drag across it.
It only sends input while the app is in the foreground.
