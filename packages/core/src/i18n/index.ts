/**
 * Shared translation catalogues. `en` is the reference: every key must exist in `es` (checked by tests).
 * Messages use a subset of ICU MessageFormat: `{variable}` and plurals,
 * `{count, plural, =0 {none} one {# activity} other {# activities}}`, chosen with `Intl.PluralRules`.
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

/**
 * The plural category of a number. Hermes (the Android app's engine) has no `Intl.PluralRules`: there,
 * the rule of both supported languages is enough (1 is "one", everything else "other").
 */
export function pluralCategory(locale: Locale, count: number): string {
  if (typeof Intl !== 'undefined' && typeof Intl.PluralRules === 'function') {
    return new Intl.PluralRules(locale).select(count);
  }
  return count === 1 ? 'one' : 'other';
}

/** Finds the `}` that closes the `{` at `open`. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** Expands `{name, plural, …}` blocks; `#` inside a branch is the number, formatted for the locale. */
function plurals(locale: Locale, template: string, values: Record<string, string | number>): string {
  const head = /\{(\w+),\s*plural,/g;
  let out = '';
  let from = 0;
  for (let m = head.exec(template); m; m = head.exec(template)) {
    const end = closing(template, m.index);
    if (end < 0) break;
    const name = m[1] ?? '';
    const count = Number(values[name]);
    const options = new Map<string, string>();
    const body = template.slice(m.index + m[0].length, end);
    const option = /\s*(=\d+|\w+)\s*\{/g;
    for (let o = option.exec(body); o; o = option.exec(body)) {
      const open = o.index + o[0].length - 1;
      const close = closing(body, open);
      if (close < 0) break;
      options.set(o[1] ?? '', body.slice(open + 1, close));
      option.lastIndex = close + 1;
    }
    const branch =
      options.get(`=${count}`) ?? options.get(pluralCategory(locale, count)) ?? options.get('other') ?? '';
    out += template.slice(from, m.index) + branch.replace(/#/g, count.toLocaleString(locale));
    from = end + 1;
    head.lastIndex = end + 1;
  }
  return out + template.slice(from);
}

/** Looks up a message and fills {placeholders} and plurals. Falls back to English, then to the key. */
export function message(
  locale: Locale,
  key: MessageKey,
  values: Record<string, string | number> = {},
): string {
  const template = catalogues[locale][key] ?? catalogues.en[key] ?? key;
  return plurals(locale, template, values).replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}
