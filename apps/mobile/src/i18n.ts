/**
 * The app speaks the same catalogues as the PWA (packages/core): the language picked in Settings, or
 * the phone's (OS-502, expo-localization), English when it is neither.
 */
import { LOCALES, message, resolveLocale, type Locale, type MessageKey } from '@zankup/core';
import { getLocales } from 'expo-localization';

import { keys, readSync, storage } from './storage';

function chosen(): Locale | null {
  const saved = readSync(keys.language);
  return (LOCALES as readonly string[]).includes(saved ?? '') ? (saved as Locale) : null;
}

export const locale: Locale = chosen() ?? resolveLocale(getLocales().map((l) => l.languageTag));

export const t = (key: MessageKey, values?: Record<string, string | number>) => message(locale, key, values);

/** Saves the choice; it applies the next time the app starts (like the PWA's reload). */
export async function saveLanguage(choice: Locale | null): Promise<void> {
  if (choice) await storage.setItem(keys.language, choice);
  else await storage.removeItem(keys.language);
}
