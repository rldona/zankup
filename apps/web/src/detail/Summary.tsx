import { activitySummaryQuery, aiStatusQuery } from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../api';
import { MaterialIcon } from '../MaterialIcon';
import { t } from '../i18n';

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
        {(write.isError || rename.isError) && (
          <p className="note" role="alert">
            {t('summary.failed')}
          </p>
        )}
      </div>
    </section>
  );
}
