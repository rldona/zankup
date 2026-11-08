import { useApiHealth } from './useApiHealth';

// Placeholder until the app skeleton (OS-201). Text is hard-coded only here; i18n arrives with OS-223.
export function App() {
  const health = useApiHealth();
  const status =
    health.state === 'ok'
      ? `API connected · v${health.version}`
      : health.state === 'down'
        ? 'API unreachable'
        : 'Checking API…';

  return (
    <main className="placeholder">
      <h1>OpenSport</h1>
      <p>Your sports data, on another level.</p>
      <p className={`status status-${health.state}`} role="status">
        {status}
      </p>
    </main>
  );
}
