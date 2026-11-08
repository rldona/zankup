import { ApiError, activityQuery, formatDuration } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';

import { api } from '../api';
import { locale, t } from '../i18n';

/** Placeholder detail: the route and its data. The map, charts and splits are OS-205 onwards. */
export function Activity() {
  const id = Number(useParams().id);
  const activity = useQuery({ ...activityQuery(api, id), enabled: Number.isInteger(id) && id > 0 });

  return (
    <section>
      <Link to="/">← {t('activity.back')}</Link>
      {activity.isPending && <p className="state">{t('common.loading')}</p>}
      {(!Number.isInteger(id) || (activity.error instanceof ApiError && activity.error.status === 404)) && (
        <p className="state">{t('activity.notFound')}</p>
      )}
      {activity.data && (
        <>
          <h1>{activity.data.name ?? activity.data.sport}</h1>
          <p>
            {new Date(activity.data.start_utc).toLocaleString(locale)} ·{' '}
            {activity.data.distance_m ? `${(activity.data.distance_m / 1000).toFixed(2)} km · ` : ''}
            {formatDuration(activity.data.moving_s ?? activity.data.duration_s)}
          </p>
        </>
      )}
    </section>
  );
}
