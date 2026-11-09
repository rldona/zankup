/**
 * Garmin syncs on the phone (OS-511), as in the PWA (OS-209, OS-226): the latest runs, polled every 2 s
 * while one is queued or running, starting one (or the whole history), and refreshing the feed, the
 * profile and the widget when a run finishes.
 */
import { queryKeys, syncsQuery, type SyncRun } from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useApi } from './auth';
import { t } from './i18n';
import { refreshWidget } from './widget/handler';

export const active = (run: Pick<SyncRun, 'status'> | undefined) =>
  run?.status === 'queued' || run?.status === 'running';

export function useSync() {
  const api = useApi();
  const queryClient = useQueryClient();
  const runs = useQuery({
    ...syncsQuery(api),
    refetchInterval: (query) => (active(query.state.data?.[0]) ? 2000 : false),
  });
  const latest = runs.data?.[0];

  const was = useRef(latest?.status);
  useEffect(() => {
    if (was.current && active({ status: was.current }) && latest && !active(latest)) {
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
      void refreshWidget(api).catch(() => undefined);
    }
    was.current = latest?.status;
  }, [api, latest, queryClient]);

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

  return { runs: runs.data ?? [], latest, running: active(latest), start, refetch: runs.refetch };
}
