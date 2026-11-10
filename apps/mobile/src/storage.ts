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
} as const;

export const storage = Storage;

export function readSync(key: string): string | null {
  try {
    return Storage.getItemSync(key);
  } catch {
    return null;
  }
}
