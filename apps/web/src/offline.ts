/**
 * Offline mode (OS-211): what has been seen stays readable without a connection. The feed, the
 * activities opened and their series are kept in IndexedDB (through TanStack Query's persister) for a
 * week; the app itself and the map tiles are cached by the service worker (vite.config.ts).
 */
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Query } from '@tanstack/react-query';
import { del, get, set } from 'idb-keyval';
import { useSyncExternalStore } from 'react';

export const OFFLINE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const KEY = 'zankup-query-cache';

export const persister = createAsyncStoragePersister({
  storage: typeof indexedDB === 'undefined' ? undefined : { getItem: get, setItem: set, removeItem: del },
  key: KEY,
  throttleTime: 2000,
});

/** Kept for offline use: who is signed in, preferences, the feed and the activities opened. */
const KEPT = new Set(['me', 'settings', 'activities', 'activity', 'profile']);

export function keepOffline(query: Query): boolean {
  return query.state.status === 'success' && KEPT.has(String(query.queryKey[0]));
}

/** On sign-out: nothing of this account stays on the device. */
export async function forgetOfflineData(): Promise<void> {
  try {
    await del(KEY);
  } catch {
    // No IndexedDB: nothing was kept.
  }
}

const subscribe = (notify: () => void) => {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
};

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
