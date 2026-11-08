import { queryKeys, syncsQuery, type SyncRun } from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { api } from './api';
import { t } from './i18n';

export const active = (run: SyncRun | undefined) => run?.status === 'queued' || run?.status === 'running';

/**
 * Garmin syncs (OS-209, OS-226): the latest runs, polled every 2 s while one is queued or running,
 * starting one (or the whole history), and refreshing the feed when a run finishes.
 */
export function useSync() {
  const queryClient = useQueryClient();
  const runs = useQuery({
    ...syncsQuery(api),
    refetchInterval: (query) => (active(query.state.data?.[0]) ? 2000 : false),
  });
  const latest = runs.data?.[0];

  // When a run finishes, the feed, its months and the profile show what it brought.
  const was = useRef(latest?.status);
  useEffect(() => {
    if (was.current && active({ status: was.current } as SyncRun) && latest && !active(latest)) {
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
    }
    was.current = latest?.status;
  }, [latest, queryClient]);

  const start = useMutation({
    mutationFn: async (history: boolean) => {
      const { data, error, response } = await api.POST('/api/sync', { body: { history } });
      if (!data) {
        const detail = (error as { detail?: unknown } | undefined)?.detail;
        throw new Error(
          response.status === 409 ? t('sync.notConfigured') : String(detail ?? t('common.error')),
        );
      }
      return data;
    },
    onSuccess: (run) =>
      queryClient.setQueryData<SyncRun[]>(queryKeys.syncs, (old) => [
        run,
        ...(old ?? []).filter((r) => r.id !== run.id),
      ]),
  });

  return { runs: runs.data ?? [], latest, running: active(latest), start };
}
