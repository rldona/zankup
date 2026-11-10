import { activitySummaryQuery, aiStatusQuery } from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api';
import { t } from '../i18n';

/**
 * The model's summary of the activity (OS-703): the sentences, the highlights and the suggested title,
 * with a button to write it (again). Hidden when this server has no model, unless a summary exists.
 */
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
  const can = status.data?.available && status.data.enabled && status.data.summaries;
  const row = summary.data;
  if (!row && !can) return null;
  if (!row && summary.isPending) return null;
  return (
    <section className="panel summary" aria-labelledby="summary-title">
      <div className="ph">
        <h2 id="summary-title">{t('summary.title')}</h2>
        {can && (
          <button type="button" className="link" onClick={() => write.mutate()} disabled={write.isPending}>
            {write.isPending ? t('coach.thinking') : row ? t('summary.regenerate') : t('summary.generate')}
          </button>
        )}
      </div>
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
    </section>
  );
}
