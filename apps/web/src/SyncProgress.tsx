import type { SyncRun } from '@zankup/core';

import { t } from './i18n';
import { active } from './sync';

/** What a run is doing or how it ended, in a sentence, and its numbers. */
export function SyncProgress({ run }: { run: SyncRun }) {
  const p = run.progress;
  return (
    <div className="syncprogress" aria-live="polite">
      <p>
        <b>
          {run.status === 'queued' && t('sync.queued')}
          {run.status === 'running' && t('sync.running')}
          {run.status === 'success' && t('sync.success', { count: run.new_count })}
          {run.status === 'error' && t('sync.error', { error: run.error ?? '' })}
        </b>
      </p>
      {active(run) && p.windows != null && p.windows > 1 && p.window != null && (
        <>
          <progress max={p.windows} value={p.window} />
          <p className="note">{t('sync.window', { window: p.window, windows: p.windows })}</p>
        </>
      )}
      {p.listed != null && (
        <p className="note num">
          {t('sync.counts', { listed: p.listed, new: p.new ?? 0, downloaded: p.downloaded ?? 0 })}
        </p>
      )}
      {run.pending_imports > 0 && <p className="note">{t('sync.pending', { count: run.pending_imports })}</p>}
      {!!p.no_fit && <p className="note">{t('sync.noFit', { count: p.no_fit })}</p>}
    </div>
  );
}
