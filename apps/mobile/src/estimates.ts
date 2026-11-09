import { formatDuration, type MessageKey } from '@zankup/core';

import { locale, t } from './i18n';
import type { useFormat } from './prefs';

type Format = ReturnType<typeof useFormat>;

export const ESTIMATE_ORDER = ['ftp', 'critical_speed', 'vdot', 'lthr', 'hr_max'] as const;
export const RACES = ['race_5k', 'race_10k', 'race_half_marathon', 'race_marathon'] as const;

export function estimateValue(kind: string, value: number, format: Format): string {
  if (kind === 'ftp') return `${Math.round(value)} W`;
  if (kind === 'critical_speed') return format.pace(value);
  if (kind === 'lthr' || kind === 'hr_max') return `${Math.round(value)} bpm`;
  if (kind === 'vdot') return value.toFixed(1);
  if (kind.startsWith('race_')) return formatDuration(value);
  return value.toFixed(1);
}

export function effortName(key: string): string {
  const id = `effort.${key}` as MessageKey;
  const text = t(id);
  return text === id ? key : text;
}

export function estimateName(kind: string): string {
  const id = `estimate.${kind}` as MessageKey;
  const text = t(id);
  return text === id ? kind : text;
}

/** "12 nov 2025": a day of the API (YYYY-MM-DD) in the app's language. */
export const shortDay = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

/** The method an estimate was made with, in words: "riegel:10" → "Riegel's formula from your best 10 km". */
export function methodText(method: string): string {
  const [key = '', km = ''] = method.split(':');
  const id = `method.${key}` as MessageKey;
  const text = t(id, { km: km ? Number(km).toLocaleString(locale) : '' });
  return text === id ? method : text;
}
