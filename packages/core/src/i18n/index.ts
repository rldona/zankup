/**
 * Shared translation catalogues. `en` is the reference: every key must exist in `es` (checked by tests).
 * Messages use ICU syntax ({variable}), so i18next with ICU (OS-223) can load these files unchanged.
 * `message()` is a minimal lookup until then.
 */
import en from './en.json';
import es from './es.json';

export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export type MessageKey = keyof typeof en;
export const catalogues: Record<Locale, Record<MessageKey, string>> = { en, es };

/** First supported language in the browser's preference list, or English. */
export function resolveLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    const match = LOCALES.find((l) => l === base);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

/** Looks up a message and fills simple {placeholders}. Falls back to English, then to the key. */
export function message(
  locale: Locale,
  key: MessageKey,
  values: Record<string, string | number> = {},
): string {
  const template = catalogues[locale][key] ?? catalogues.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}
