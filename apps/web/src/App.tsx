import { message, resolveLocale } from '@opensport/core';

import { useApiHealth } from './useApiHealth';

// Placeholder until the app skeleton (OS-201). The language follows the browser until Settings exists (OS-223).
const locale = resolveLocale(navigator.languages);

export function App() {
  const health = useApiHealth();
  const status =
    health.state === 'ok'
      ? message(locale, 'api.connected', { version: health.version })
      : health.state === 'degraded'
        ? message(locale, 'api.degraded')
        : message(locale, health.state === 'down' ? 'api.down' : 'api.checking');

  return (
    <main className="placeholder" lang={locale}>
      <h1>{message(locale, 'app.name')}</h1>
      <p>{message(locale, 'app.claim')}</p>
      <p className={`status status-${health.state}`} role="status">
        {status}
      </p>
    </main>
  );
}
