import { formatters, settingsQuery, SPORTS, type Sport } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useApi } from './auth';
import { locale } from './i18n';

/** Formatting with the account's units (metric or imperial), like the PWA. */
export function useFormat() {
  const api = useApi();
  const settings = useQuery({ ...settingsQuery(api), staleTime: 60_000 });
  const units = settings.data?.units ?? 'metric';
  return useMemo(() => formatters({ locale, units }), [units]);
}

/** Max HR for zones: the one set in Settings, or the engine's estimate (like the PWA). */
export function useHrMax(): { hrMax: number | null; estimated: boolean } {
  const api = useApi();
  const settings = useQuery({ ...settingsQuery(api), staleTime: 60_000 });
  const set = settings.data?.hr_max ?? null;
  const estimate = settings.data?.hr_max_estimate ?? null;
  return { hrMax: set ?? estimate, estimated: set == null && estimate != null };
}

/** The account's units, for what the formatters do not cover (weather). */
export function useUnits(): 'metric' | 'imperial' {
  const api = useApi();
  const settings = useQuery({ ...settingsQuery(api), staleTime: 60_000 });
  return settings.data?.units ?? 'metric';
}

export const asSport = (value: string): Sport =>
  (SPORTS as readonly string[]).includes(value) ? (value as Sport) : 'other';
