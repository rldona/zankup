import { formatDuration, type MessageKey } from '@zankup/core';

import { t } from './i18n';
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
