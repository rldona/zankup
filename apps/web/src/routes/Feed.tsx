import { activitiesQuery, formatDuration, SPORTS, type ActivitySummary, type Sport } from '@zankup/core';
import { useInfiniteQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useMatch } from 'react-router';

import { api } from '../api';
import { locale, t } from '../i18n';

/**
 * Feed and detail side by side on desktop (list 400 px, detail beside it); on mobile, one or the
 * other depending on the route. The cards, chips and months are OS-204.
 */
export function Feed() {
  const detail = useMatch('/activities/:id') !== null;
  const feed = useInfiniteQuery(activitiesQuery(api));
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className={`feedwrap${detail ? ' detail' : ''}`}>
      <section className="feedcol">
        <h1>{t('feed.title')}</h1>
        {feed.isPending && <p className="state">{t('common.loading')}</p>}
        {feed.isError && (
          <p className="state" role="alert">
            {t('common.error')}
          </p>
        )}
        {feed.isSuccess && items.length === 0 && <p className="state">{t('feed.empty')}</p>}
        <ul className="list">
          {items.map((activity) => (
            <li key={activity.id}>
              <NavLink
                to={`/activities/${activity.id}`}
                className={({ isActive }) => (isActive ? 'on' : undefined)}
              >
                <strong>{activity.name ?? sportName(activity)}</strong>
                <span>{summary(activity)}</span>
              </NavLink>
            </li>
          ))}
        </ul>
        {feed.hasNextPage && (
          <button type="button" onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
            {feed.isFetchingNextPage ? t('common.loading') : t('feed.more')}
          </button>
        )}
      </section>
      <section className="detailcol">
        <Outlet />
      </section>
    </div>
  );
}

/** The detail column before an activity is picked (desktop only: on mobile the list fills the screen). */
export function PickActivity() {
  return <p className="state pick">{t('feed.pick')}</p>;
}

function sportName(activity: ActivitySummary): string {
  const sport: Sport = (SPORTS as readonly string[]).includes(activity.sport)
    ? (activity.sport as Sport)
    : 'other';
  return t(`sport.${sport}`);
}

function summary(activity: ActivitySummary): string {
  const date = new Date(activity.start_utc).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const distance = activity.distance_m ? `${(activity.distance_m / 1000).toFixed(2)} km` : null;
  return [date, distance, formatDuration(activity.moving_s ?? activity.duration_s)]
    .filter(Boolean)
    .join(' · ');
}
