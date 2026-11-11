/**
 * The Android app (phase 5). One build works with any instance: the URL is asked on first launch.
 *
 * - `google-services.json` (Firebase, for notifications) is optional: without it the app builds and
 *   simply cannot receive notifications. It is never committed.
 * - `ZANKUP_DEV=1` builds "Zankup Dev" (`com.zankup.app.dev`, JavaScript served by Metro): a separate
 *   app that sits beside the release one, so the phone always has a Zankup that needs no computer. It
 *   allows plain HTTP, to reach a local API (`adb reverse tcp:8000 tcp:8000`), and has no Firebase
 *   (its project only knows `com.zankup.app`), so no push notifications.
 */
import { existsSync } from 'node:fs';

import type { ConfigContext, ExpoConfig } from 'expo/config';

const dev = process.env.ZANKUP_DEV === '1';
const firebase = !dev && existsSync('./google-services.json') ? './google-services.json' : undefined;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: dev ? 'Zankup Dev' : 'Zankup',
  slug: 'zankup',
  scheme: dev ? 'zankup-dev' : 'zankup',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  android: {
    package: dev ? 'com.zankup.app.dev' : 'com.zankup.app',
    versionCode: 1,
    adaptiveIcon: {
      backgroundColor: '#20c997',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    googleServicesFile: firebase,
    permissions: [
      'USE_BIOMETRIC',
      'POST_NOTIFICATIONS',
      // Health Connect, read only (OS-607).
      'android.permission.health.READ_SLEEP',
      'android.permission.health.READ_RESTING_HEART_RATE',
      'android.permission.health.READ_HEART_RATE_VARIABILITY',
      'android.permission.health.READ_OXYGEN_SATURATION',
      'android.permission.health.READ_RESPIRATORY_RATE',
      'android.permission.health.READ_STEPS',
      // Reading more than the 30 days before the permission was given (the year's history).
      'android.permission.health.READ_HEALTH_DATA_HISTORY',
    ],
  },
  plugins: [
    'expo-router',
    '@maplibre/maplibre-react-native',
    'expo-secure-store',
    'expo-local-authentication',
    'expo-localization',
    'expo-sqlite',
    'expo-background-task',
    ['expo-notifications', { color: '#20c997', defaultChannel: 'default' }],
    'react-native-health-connect',
    './plugins/withReleaseSigning',
    [
      'expo-build-properties',
      {
        android: {
          usesCleartextTraffic: dev,
          minSdkVersion: 26, // Health Connect
          // WorkManager (background sync) finds its Room database by name: R8 must keep it.
          extraProguardRules: [
            '-keep class * extends androidx.room.RoomDatabase { <init>(); }',
            '-keep class androidx.work.impl.WorkDatabase_Impl { *; }',
          ].join('\n'),
        },
      },
    ],
    [
      'react-native-android-widget',
      {
        widgets: [
          {
            name: 'Latest',
            label: dev ? 'Zankup Dev' : 'Zankup',
            description: 'Your latest activity and today’s form',
            minWidth: '250dp',
            minHeight: '110dp',
            targetCellWidth: 4,
            targetCellHeight: 2,
            previewImage: './assets/icon.png',
            updatePeriodMillis: 1800000,
          },
        ],
      },
    ],
    [
      'expo-splash-screen',
      { image: './assets/splash-icon.png', imageWidth: 160, backgroundColor: '#111111' },
    ],
  ],
  experiments: { typedRoutes: false },
  extra: { eas: { projectId: process.env.EAS_PROJECT_ID } },
});
