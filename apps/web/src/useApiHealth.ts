import { useEffect, useState } from 'react';

export type ApiHealth = { state: 'checking' } | { state: 'ok'; version: string } | { state: 'down' };

/** Calls GET /api/health: the Vite proxy in development, the Vercel rewrite to Railway in production. */
export function useApiHealth(): ApiHealth {
  const [health, setHealth] = useState<ApiHealth>({ state: 'checking' });

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { status?: string; version?: string };
        setHealth(body.status === 'ok' ? { state: 'ok', version: body.version ?? '?' } : { state: 'down' });
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
