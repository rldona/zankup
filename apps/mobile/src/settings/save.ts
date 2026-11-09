import { settingsQuery, type Preferences } from '@zankup/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useApi } from '../auth';

type Changes = Partial<
  Pick<
    Preferences,
    | 'language'
    | 'units'
    | 'hr_max'
    | 'hr_rest'
    | 'zone_model'
    | 'lthr'
    | 'ftp'
    | 'privacy_zones'
    | 'notifications'
    | 'ai'
  >
>;

/** Saves some preferences and keeps the cached copy in step, so every screen sees them at once. */
export function useSaveSettings() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (changes: Changes) => {
      const { data, error } = await api.PATCH('/api/settings', { body: changes });
      if (!data) throw new Error(String((error as { detail?: unknown } | undefined)?.detail ?? 'error'));
      return data;
    },
    onSuccess: (data) => queryClient.setQueryData(settingsQuery(api).queryKey, data),
  });
}

/** "160" → 160, "" → null. */
export const numberOrNull = (value: string): number | null => (value.trim() ? Number(value) : null);
