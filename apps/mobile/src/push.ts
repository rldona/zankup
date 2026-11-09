/**
 * Notifications on the phone (OS-507): the same ones as the PWA's (new activity, record, Garmin sync
 * failing…), sent by the API through Firebase Cloud Messaging. The app registers this phone's FCM
 * token for its signed-in device; tapping a notification opens the screen it is about.
 */
import type { ApiClient } from '@zankup/core';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { t } from './i18n';
import { screenFor } from './links';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export type PushResult = 'on' | 'denied' | 'unavailable';

export async function registerPush(api: ApiClient): Promise<PushResult> {
  if (Platform.OS !== 'android') return 'unavailable';
  await Notifications.setNotificationChannelAsync('default', {
    name: t('notifications.title'),
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  const { granted } = await Notifications.requestPermissionsAsync();
  if (!granted) return 'denied';
  try {
    const { data } = await Notifications.getDevicePushTokenAsync(); // the raw FCM token
    await api.PUT('/api/notifications/fcm', { body: { token: String(data) } });
    return 'on';
  } catch {
    return 'unavailable'; // built without google-services.json: no Firebase on this build
  }
}

export async function unregisterPush(api: ApiClient): Promise<void> {
  await api.PUT('/api/notifications/fcm', { body: { token: null } }).catch(() => undefined);
}

/** Opens the screen a notification points at ("/activities/12" → the activity). */
export function openFromNotification(url: unknown): void {
  router.push(screenFor(url) as never);
}

export function listenToTaps(): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) =>
    openFromNotification(response.notification.request.content.data?.url),
  );
  void Notifications.getLastNotificationResponseAsync().then((last) => {
    if (last) openFromNotification(last.notification.request.content.data?.url);
  });
  return () => subscription.remove();
}
