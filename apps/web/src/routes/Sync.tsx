import { locale, t } from '../i18n';
import { useSync } from '../sync';
import { SyncProgress } from '../SyncProgress';

/** The Sync screen (OS-209, OS-226): sync now, load the whole history, and the latest runs. */
export function Sync() {
  const { runs, latest, running, start } = useSync();
  return (
    <section className="page">
      <h1>{t('sync.title')}</h1>
      <p className="note">{t('sync.auto')}</p>
      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={() => start.mutate(false)}
          disabled={running || start.isPending}
        >
          {t('sync.now')}
        </button>
      </div>
      {start.isError && (
        <p className="note" role="alert">
          {start.error.message}
        </p>
      )}
      {latest && (
        <div className="panel">
          <SyncProgress run={latest} />
        </div>
      )}

      <h2>{t('sync.history')}</h2>
      <p className="note">{t('sync.historyHelp')}</p>
      <div className="actions">
        <button type="button" onClick={() => start.mutate(true)} disabled={running || start.isPending}>
          {t('sync.historyStart')}
        </button>
      </div>

      {runs.length > 0 && (
        <>
          <h2>{t('sync.recent')}</h2>
          <ul className="rows">
            {runs.map((run) => (
              <li key={run.id}>
                <span>
                  <b>{t(`sync.trigger.${run.trigger}`)}</b>
                  <small className="note">
                    {new Date(run.started_at).toLocaleString(locale, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    {run.status === 'success' && ` · ${t('sync.success', { count: run.new_count })}`}
                    {run.error && ` · ${run.error}`}
                  </small>
                </span>
                <span className={`badge ${run.status}`}>{t(`sync.status.${run.status}`)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
