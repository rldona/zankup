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

export const asSport = (value: string): Sport =>
  (SPORTS as readonly string[]).includes(value) ? (value as Sport) : 'other';
