import { settingsQuery, type FormatOptions, type Units } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { api } from './api';
import { locale } from './i18n';

export type Prefs = FormatOptions & { units: Units; hrMax: number | null; hrMaxEstimated: boolean };

/**
 * Formatting options and heart-rate settings from the user's preferences (OS-212). Stable between
 * renders while they do not change, so charts built from them are not redrawn on every hover.
 */
export function usePrefs(): Prefs {
  const settings = useQuery({ ...settingsQuery(api), staleTime: 60_000 });
  const units = settings.data?.units ?? 'metric';
  const set = settings.data?.hr_max ?? null;
  const estimate = settings.data?.hr_max_estimate ?? null;
  return useMemo(
    () => ({ locale, units, hrMax: set ?? estimate, hrMaxEstimated: set == null && estimate != null }),
    [units, set, estimate],
  );
}
