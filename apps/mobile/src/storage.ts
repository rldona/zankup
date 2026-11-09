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
  queryCache: 'zankup.queryCache',
} as const;

export const storage = Storage;

export function readSync(key: string): string | null {
  try {
    return Storage.getItemSync(key);
  } catch {
    return null;
  }
}
