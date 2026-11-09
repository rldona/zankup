/**
 * Background sync (OS-506): every ~30 minutes Android (WorkManager, through expo-background-task) lets
 * the app refresh the feed, keep the latest activities' series for offline use and update the widget,
 * so the app opens with today's activity already there. It uses the stored refresh token only when it
 * can be read without the fingerprint (weak-biometric lock or no biometrics); otherwise it waits for
 * the next time the app is opened.
 */
import { activitiesQuery, createApiClient, weekQuery } from '@zankup/core';
import * as BackgroundTask from 'expo-background-task';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';

import { persistQueryClientRestore, persistQueryClientSave } from '@tanstack/react-query-persist-client';

import { keepOffline, OFFLINE_MAX_AGE, persister, queryClient, saveStreams, savedStreams } from './offline';
import { instanceUrl } from './session';
import { readSync, storage } from './storage';
import { refreshWidget } from './widget/handler';

export const TASK = 'zankup-sync';
const LATEST = 5;

export async function backgroundSync(): Promise<'done' | 'skipped'> {
  const baseUrl = instanceUrl();
  if (!baseUrl || readSync('zankup.refresh.protected') !== '0') return 'skipped';
  const refresh = await SecureStore.getItemAsync('zankup.refresh');
  if (!refresh) return 'skipped';
  const tokens = await createApiClient(baseUrl).POST('/api/auth/refresh', {
    body: { refresh_token: refresh, rotate: false },
  });
  if (!tokens.data) return 'skipped';
  const api = createApiClient(baseUrl);
  const access = tokens.data.access_token;
  api.use({
    onRequest({ request }) {
      request.headers.set('Authorization', `Bearer ${access}`);
      return request;
    },
  });
  // Headless: start from what the app had kept, add the fresh data, and keep it again.
  await persistQueryClientRestore({ queryClient, persister, maxAge: OFFLINE_MAX_AGE }).catch(() => undefined);
  const feed = activitiesQuery(api);
  const page = await feed.queryFn({ pageParam: undefined });
  queryClient.setQueryData(feed.queryKey, { pages: [page], pageParams: [undefined] });
  const today = new Date().toISOString().slice(0, 10);
  const week = weekQuery(api, today);
  queryClient.setQueryData(week.queryKey, await week.queryFn({}));
  for (const item of page.items.slice(0, LATEST)) {
    if (!item.has_gps || (await savedStreams(item.id))) continue;
    const { data } = await api.GET('/api/activities/{activity_id}/streams', {
      params: { path: { activity_id: item.id } },
    });
    if (data) await saveStreams(item.id, data);
  }
  await persistQueryClientSave({
    queryClient,
    persister,
    dehydrateOptions: { shouldDehydrateQuery: keepOffline },
  });
  await storage.setItem('zankup.lastBackgroundSync', String(Date.now()));
  await refreshWidget(api);
  return 'done';
}

export function defineBackgroundSync(): void {
  if (TaskManager.isTaskDefined(TASK)) return;
  TaskManager.defineTask(TASK, async () => {
    try {
      await backgroundSync();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function scheduleBackgroundSync(): Promise<void> {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
  if (!(await TaskManager.isTaskRegisteredAsync(TASK))) {
    await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 30 });
  }
}
