/**
 * Offline mode (OS-505): what has been seen stays readable without coverage.
 *
 * - TanStack Query's cache (every screen seen: the feed, activities, stats, health, goals…) is persisted
 *   in SQLite through the key-value store, for a week.
 * - When the server cannot be reached (no coverage, or it answers 429/5xx) the screens keep what they
 *   have and a notice says so (`useServerUnreachable`), until a request goes through again.
 * - Activity series, the heavy part, have their own SQLite table: kept for the activities opened and the
 *   latest ones the background sync fetches (OS-506), so the detail opens instantly and offline.
 */
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { MutationCache, QueryCache, QueryClient, type Query } from '@tanstack/react-query';
import { ApiError, type ActivityStreams, type ApiClient } from '@zankup/core';
import { useSyncExternalStore } from 'react';
import * as SQLite from 'expo-sqlite';

import { keys, storage } from './storage';

export const OFFLINE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const KEPT_STREAMS = 60;

// --- whether the server answers -------------------------------------------------------------------
//
// No coverage, the server down or its edge turning requests away (429, 5xx): the app then shows what it
// kept and says so, until any request goes through again.

let unreachable = false;
const listeners = new Set<() => void>();

function setUnreachable(value: boolean): void {
  if (unreachable === value) return;
  unreachable = value;
  listeners.forEach((listener) => listener());
}

/** A failure that says nothing about the request itself: no network, or the server not answering. */
export function isUnreachable(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 429 || error.status >= 500;
  return error instanceof TypeError || /network|fetch|timed? ?out|abort/i.test(String(error));
}

/** True while the server cannot be reached: screens keep showing what was kept. */
export function useServerUnreachable(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => unreachable,
  );
}

const noted = {
  onError: (error: unknown) => {
    if (isUnreachable(error)) setUnreachable(true);
  },
  onSuccess: () => setUnreachable(false),
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache(noted),
  mutationCache: new MutationCache(noted),
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: OFFLINE_MAX_AGE, networkMode: 'offlineFirst', retry: 1 },
  },
});

export const persister = createAsyncStoragePersister({
  storage: {
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => storage.setItem(key, value),
    removeItem: (key) => storage.removeItem(key),
  },
  key: keys.queryCache,
  throttleTime: 2000,
});

/** Not kept: service keys and the instance's settings (only for Settings, never offline). */
const NOT_KEPT = new Set(['keys', 'instance']);

/** Every screen seen is kept for a week, so it opens without the server; series have their own table. */
export function keepOffline(query: Query): boolean {
  return (
    query.state.data !== undefined &&
    !NOT_KEPT.has(String(query.queryKey[0])) &&
    query.queryKey[2] !== 'streams'
  );
}

// --- series --------------------------------------------------------------------------------------------

let database: Promise<SQLite.SQLiteDatabase> | null = null;

function db(): Promise<SQLite.SQLiteDatabase> {
  database ??= SQLite.openDatabaseAsync('zankup.db').then(async (connection) => {
    await connection.execAsync(
      'CREATE TABLE IF NOT EXISTS streams (activity_id INTEGER PRIMARY KEY, data TEXT NOT NULL, saved_at INTEGER NOT NULL)',
    );
    return connection;
  });
  return database;
}

export async function savedStreams(id: number): Promise<ActivityStreams | null> {
  const row = await (
    await db()
  ).getFirstAsync<{ data: string }>('SELECT data FROM streams WHERE activity_id = ?', id);
  return row ? (JSON.parse(row.data) as ActivityStreams) : null;
}

export async function saveStreams(id: number, streams: ActivityStreams): Promise<void> {
  const connection = await db();
  await connection.runAsync(
    'INSERT OR REPLACE INTO streams (activity_id, data, saved_at) VALUES (?, ?, ?)',
    id,
    JSON.stringify(streams),
    Date.now(),
  );
  await connection.runAsync(
    'DELETE FROM streams WHERE activity_id NOT IN (SELECT activity_id FROM streams ORDER BY saved_at DESC LIMIT ?)',
    KEPT_STREAMS,
  );
}

/** The series of an activity: from the phone when kept, else from the API (and then kept). */
export function streamsQuery(api: ApiClient, id: number) {
  return {
    queryKey: ['activity', id, 'streams'] as const,
    staleTime: Infinity, // series never change once recorded
    queryFn: async () => {
      const kept = await savedStreams(id);
      if (kept) return kept;
      const { data, error } = await api.GET('/api/activities/{activity_id}/streams', {
        params: { path: { activity_id: id } },
      });
      if (!data) throw new Error(String((error as { detail?: string } | undefined)?.detail ?? 'streams'));
      await saveStreams(id, data);
      return data;
    },
  };
}

/** On sign-out nothing of the account stays on the phone. */
export async function forgetOfflineData(): Promise<void> {
  queryClient.clear();
  await persister.removeClient();
  await (await db()).execAsync('DELETE FROM streams');
}
