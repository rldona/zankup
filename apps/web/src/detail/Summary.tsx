import { activityReportQuery, activitySummaryQuery, aiStatusQuery, emphasis } from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api';
import { MaterialIcon } from '../MaterialIcon';
import { t } from '../i18n';
import { Modal } from './Tools';

/**
 * Zankup Coach's summary of the activity (OS-703): the sentences, the highlights and the suggested title.
 * Before there is one, it says what the Coach will write and offers to; a written summary stays as it
 * is. Hidden when this server has no model, unless a summary exists.
 */
const FOLDED_KEY = 'zankup-coach-folded';

function readFolded(): boolean {
  try {
    return localStorage.getItem(FOLDED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeFolded(folded: boolean) {
  try {
    if (folded) localStorage.setItem(FOLDED_KEY, '1');
    else localStorage.removeItem(FOLDED_KEY);
  } catch {
    // Storage blocked: it folds for this page only.
  }
}

export function Summary({ activityId, name }: { activityId: number; name: string | null }) {
  const queryClient = useQueryClient();
  const status = useQuery({ ...aiStatusQuery(api), retry: false });
  const summary = useQuery(activitySummaryQuery(api, activityId));
  const write = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST('/api/activities/{activity_id}/summary', {
        params: { path: { activity_id: activityId } },
      });
      if (!data) throw new Error(String((error as { detail?: unknown } | undefined)?.detail ?? 'error'));
      return data;
    },
    onSuccess: (data) => queryClient.setQueryData(activitySummaryQuery(api, activityId).queryKey, data),
  });
  const rename = useMutation({
    mutationFn: async (title: string) => {
      const { data, error } = await api.PATCH('/api/activities/{activity_id}', {
        params: { path: { activity_id: activityId } },
        body: { name: title },
      });
      if (!data) throw new Error(String((error as { detail?: unknown } | undefined)?.detail ?? 'error'));
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['activity', activityId] });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
  });
  const [folded, setFolded] = useState(readFolded);
  const [more, setMore] = useState(false);
  const can = status.data?.available && status.data.enabled && status.data.summaries;
  const row = summary.data;
  if (!row && !can) return null;
  if (!row && summary.isPending) return null;
  return (
    <section className="panel summary" aria-labelledby="summary-title">
      <div className="ph coach-head">
        <span className="wand">
          <MaterialIcon name="wand_stars" />
        </span>
        <div>
          <h2 id="summary-title">{t('summary.aiTitle')}</h2>
          <p className="note">{t('summary.aiSubtitle')}</p>
        </div>
        {/* As on the app: the analysis folds away, and stays folded on every activity until opened. */}
        <button
          type="button"
          className="mapbtn flat fold"
          aria-expanded={!folded}
          aria-controls="summary-body"
          aria-label={t(folded ? 'summary.show' : 'summary.hide')}
          title={t(folded ? 'summary.show' : 'summary.hide')}
          onClick={() => {
            writeFolded(!folded);
            setFolded(!folded);
          }}
        >
          <MaterialIcon name={folded ? 'keyboard_arrow_down' : 'keyboard_arrow_up'} />
        </button>
      </div>
      <div id="summary-body" hidden={folded}>
        {!row && can && (
          <>
            <p className="desc">{t('summary.pitch')}</p>
            <button
              type="button"
              className="primary"
              onClick={() => write.mutate()}
              disabled={write.isPending}
            >
              <MaterialIcon name="wand_stars" />
              {write.isPending ? t('summary.writing') : t('summary.write')}
            </button>
          </>
        )}
        {row && (
          <>
            <p className="desc">{row.summary}</p>
            {row.highlights.length > 0 && (
              <ul className="highlights">
                {row.highlights.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
            {row.suggested_title && row.suggested_title !== name && (
              <p className="note suggested">
                {t('summary.suggested')}: <b>{row.suggested_title}</b>
                {can && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      className="link"
                      onClick={() => rename.mutate(row.suggested_title)}
                      disabled={rename.isPending}
                    >
                      {rename.isSuccess ? t('summary.titleUsed') : t('summary.useTitle')}
                    </button>
                  </>
                )}
              </p>
            )}
          </>
        )}
        {row && can && (
          <button type="button" className="primary" onClick={() => setMore(true)}>
            {t('report.more')}
          </button>
        )}
        {(write.isError || rename.isError) && (
          <p className="note" role="alert">
            {t('summary.failed')}
          </p>
        )}
      </div>
      {more && <ReportDialog activityId={activityId} onClose={() => setMore(false)} />}
    </section>
  );
}

/**
 * "Tell me more": the longer report on an activity, as Strava's. Written the first time it is opened
 * (a few seconds), then kept: the effort, the activity told, its place in the month, a verdict and the
 * recommendation for the next session, apart.
 */
function ReportDialog({ activityId, onClose }: { activityId: number; onClose: () => void }) {
  const report = useQuery({
    ...activityReportQuery(api, activityId),
    queryFn: async () => {
      // The one kept, or a new one: the server decides.
      const { data, error } = await api.POST('/api/activities/{activity_id}/report', {
        params: { path: { activity_id: activityId } },
      });
      if (!data) throw new Error(String((error as { detail?: unknown } | undefined)?.detail ?? 'error'));
      return data;
    },
    staleTime: Infinity,
  });
  const row = report.data;
  return (
    <Modal title={t('summary.aiTitle')} onClose={onClose} className="report">
      {!row ? (
        <p className="note" role={report.isError ? 'alert' : 'status'}>
          {report.isError ? t('report.failed') : t('report.writing')}
        </p>
      ) : (
        <article className="report-body">
          <h3>{row.headline}</h3>
          {[row.effort, row.story, row.month, row.verdict]
            .filter((p) => p.trim())
            .map((p, i) => (
              <p key={i}>
                <Emphasis text={p} />
              </p>
            ))}
          {row.next.trim() && (
            <aside className="report-next">
              <b>{t('report.next')}</b>
              <p>
                <Emphasis text={row.next} />
              </p>
            </aside>
          )}
          <button type="button" className="primary block" onClick={onClose}>
            {t('report.done')}
          </button>
        </article>
      )}
    </Modal>
  );
}

/** A Coach text with what matters most in bold (its **double asterisks**). */
function Emphasis({ text }: { text: string }) {
  return <>{emphasis(text).map((run, i) => (run.bold ? <strong key={i}>{run.text}</strong> : run.text))}</>;
}
