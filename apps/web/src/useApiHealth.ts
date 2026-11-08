import { createApiClient } from '@opensport/core';
import { useEffect, useState } from 'react';

export type ApiHealth =
  | { state: 'checking' }
  | { state: 'ok'; version: string }
  | { state: 'degraded'; version: string }
  | { state: 'down' };

const api = createApiClient();

/** Calls GET /api/health: the Vite proxy in development, the Vercel rewrite to Railway in production. */
export function useApiHealth(): ApiHealth {
  const [health, setHealth] = useState<ApiHealth>({ state: 'checking' });

  useEffect(() => {
    const controller = new AbortController();
    api
      .GET('/api/health', { signal: controller.signal })
      .then(({ data }) => {
        if (!data) return setHealth({ state: 'down' });
        setHealth({ state: data.status === 'ok' ? 'ok' : 'degraded', version: data.version });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error('API health check failed', error);
          setHealth({ state: 'down' });
        }
      });
    return () => controller.abort();
  }, []);

  return health;
}
