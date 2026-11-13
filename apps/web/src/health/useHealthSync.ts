import { healthSettingsQuery, queryKeys, type HealthSettings, type HealthSourceName } from '@zankup/core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api';

/** How often the sources are asked whether they are done, and how long before saying it goes on. */
const EVERY = 3000;
const PATIENCE = 120_000;
/** How long a result stays before closing on its own. */
const SHOWN = 6000;

export type HealthSyncState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'running'; sources: HealthSourceName[] }
  | { phase: 'done' }
  | { phase: 'slow' }
  | { phase: 'none' }
  | { phase: 'error' };

const stamps = (settings: HealthSettings) =>
  new Map(settings.sources.map((s) => [s.source, s.last_sync_at ?? null]));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * "Bring now" on Health: the server only queues a job per source, so this asks the sources' state
 * every few seconds until each queued one has a newer last sync than before the click, then refreshes
 * the health data. After two minutes it stops asking and says the sync goes on in the background.
 */
export function useHealthSync() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<HealthSyncState>({ phase: 'idle' });
  const run = useRef(0);
  useEffect(() => () => void run.current++, []);

  // A result closes on its own; the progress stays while it runs.
  useEffect(() => {
    if (state.phase === 'idle' || state.phase === 'starting' || state.phase === 'running') return;
    const timer = setTimeout(() => setState({ phase: 'idle' }), SHOWN);
    return () => clearTimeout(timer);
  }, [state]);

  const settings = () => queryClient.fetchQuery({ ...healthSettingsQuery(api), staleTime: 0 });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.wellness });

  const start = async () => {
    const id = ++run.current;
    const current = () => run.current === id;
    setState({ phase: 'starting' });
    try {
      const before = stamps(await settings());
      const queued = ((await api.POST('/api/wellness/sync')).data?.queued ?? []) as HealthSourceName[];
      if (!current()) return;
      if (queued.length === 0) return setState({ phase: 'none' });
      setState({ phase: 'running', sources: queued });
      for (const deadline = Date.now() + PATIENCE; Date.now() < deadline;) {
        await sleep(EVERY);
        if (!current()) return;
        const now = stamps(await settings());
        if (queued.every((s) => now.get(s) != null && now.get(s) !== before.get(s))) {
          refresh();
          return setState({ phase: 'done' });
        }
      }
      refresh();
      setState({ phase: 'slow' });
    } catch {
      if (current()) setState({ phase: 'error' });
    }
  };

  return {
    state,
    busy: state.phase === 'starting' || state.phase === 'running',
    start: () => void start(),
    close: () => setState({ phase: 'idle' }),
  };
}
