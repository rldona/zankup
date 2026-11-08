import { message, resolveLocale, type MessageKey } from '@zankup/core';

export type MessageKeyOf = MessageKey;

// The language follows the browser until Settings → Language exists (OS-223).
export const locale = resolveLocale(typeof navigator === 'undefined' ? [] : navigator.languages);

export const t = (key: MessageKey, values?: Record<string, string | number>) => message(locale, key, values);
