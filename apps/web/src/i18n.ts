import { LOCALES, message, resolveLocale, type Locale, type MessageKey } from '@zankup/core';

export type MessageKeyOf = MessageKey;

/**
 * The interface language (OS-223): the one picked in Settings, saved in this browser so the first paint
 * is already in it, or else the browser's own language (English when it is neither).
 */
export const LANGUAGE_KEY = 'zankup-language';

export function chosenLanguage(): Locale | null {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    return (LOCALES as readonly string[]).includes(saved ?? '') ? (saved as Locale) : null;
  } catch {
    return null;
  }
}

export const locale: Locale =
  chosenLanguage() ?? resolveLocale(typeof navigator === 'undefined' ? [] : navigator.languages);

/** Saves the choice (null: follow the browser) and reloads, so every screen and format switches. */
export function switchLanguage(choice: Locale | null, reload = () => location.reload()): void {
  try {
    if (choice) localStorage.setItem(LANGUAGE_KEY, choice);
    else localStorage.removeItem(LANGUAGE_KEY);
  } catch {
    // Storage blocked: the account keeps the choice for the next visit.
  }
  if ((choice ?? resolveLocale(navigator.languages)) !== locale) reload();
}

export const t = (key: MessageKey, values?: Record<string, string | number>) => message(locale, key, values);
