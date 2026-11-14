/**
 * Small, non-secret values kept on the phone (the instance URL, preferences, the query cache): a
 * key-value table in SQLite. Secrets go to the Android keystore instead (session.ts).
 */
import Storage from 'expo-sqlite/kv-store';

export const keys = {
  instance: 'zankup.instance',
  language: 'zankup.language',
  theme: 'zankup.theme',
  weakBiometrics: 'zankup.weakBiometrics',
  /** "0" when the person turned the fingerprint lock off. */
  biometricLock: 'zankup.biometricLock',
  queryCache: 'zankup.queryCache',
  /** The newest activity this phone has already announced (LatestActivity). */
  latestSeen: 'zankup.latestSeen',
  /** "1" when Zankup Coach's summary is folded on the activity screens. */
  coachFolded: 'zankup.coachFolded',
  /** "1" when the physical data on You are hidden behind the eye. */
  physicalHidden: 'zankup.physicalHidden',
  /** The goals whose chart is open, as a JSON list of ids. */
  goalsOpen: 'zankup.goalsOpen',
  /** The range last chosen on Progress → Fitness (1m, 3m, 6m, 1y or 2y). */
  fitnessRange: 'zankup.fitnessRange',
} as const;

export const storage = Storage;

export function readSync(key: string): string | null {
  try {
    return Storage.getItemSync(key);
  } catch {
    return null;
  }
}

/** The goals whose day-by-day chart was left open on this phone. */
export function openGoals(): Set<number> {
  try {
    const ids: unknown = JSON.parse(readSync(keys.goalsOpen) ?? '[]');
    return new Set(Array.isArray(ids) ? ids.filter((id): id is number => typeof id === 'number') : []);
  } catch {
    return new Set();
  }
}

/** Remembers a goal's chart open or closed, so it is as it was the next time the app opens. */
export function rememberGoal(id: number, open: boolean): void {
  const ids = openGoals();
  if (open) ids.add(id);
  else ids.delete(id);
  void storage.setItem(keys.goalsOpen, JSON.stringify([...ids]));
}
