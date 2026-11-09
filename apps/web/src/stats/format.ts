import { formatDuration, formatters, type MessageKey } from '@zankup/core';

import { locale, t } from '../i18n';

type Format = ReturnType<typeof formatters>;

export const ESTIMATE_ORDER = ['ftp', 'critical_speed', 'vdot', 'lthr', 'hr_max'] as const;
export const RACES = ['race_5k', 'race_10k', 'race_half_marathon', 'race_marathon'] as const;

export const day = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

export function estimateValue(kind: string, value: number, format: Format): string {
  if (kind === 'ftp') return `${Math.round(value)} W`;
  if (kind === 'critical_speed') return format.pace(value);
  if (kind === 'lthr' || kind === 'hr_max') return `${Math.round(value)} bpm`;
  if (kind === 'vdot') return value.toFixed(1);
  if (kind.startsWith('race_')) return formatDuration(value);
  return value.toFixed(1);
}

const EFFORT_KEYS: Record<string, MessageKey> = {
  '400m': 'effort.400m',
  half_mile: 'effort.half_mile',
  '1k': 'effort.1k',
  '1mile': 'effort.1mile',
  '2mile': 'effort.2mile',
  '5k': 'effort.5k',
  '10k': 'effort.10k',
  '15k': 'effort.15k',
  '10mile': 'effort.10mile',
  half_marathon: 'effort.half_marathon',
  marathon: 'effort.marathon',
};

export const effortName = (key: string) => (EFFORT_KEYS[key] ? t(EFFORT_KEYS[key] as MessageKey) : key);

/** The method an estimate was made with, in words: "riegel:10" → "Riegel's formula from your best 10 km". */
export function methodText(method: string): string {
  const [key = '', km = ''] = method.split(':');
  const id = `method.${key}`;
  const text = t(id as MessageKey, { km: km ? Number(km).toLocaleString(locale) : '' });
  return text === id ? method : text;
}
