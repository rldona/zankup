import { aiStatusQuery } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { api } from '../api';
import { LastDay, LastSevenDays, Metrics, UsualWeek } from '../home/Widgets';
import { t } from '../i18n';
import { MaterialIcon } from '../MaterialIcon';
import { WeekHeader } from '../week/WeekHeader';
import { Wordmark } from '../Wordmark';

/**
 * Home (OS-903, OS-904), as the app's: this week, the last day with activities, the metrics and the last
 * seven days, in that order at every size (docs/prototypes/web). On a phone the header is the wordmark
 * with the Coach and the notifications; from 600 px those two are in the rail.
 */
export function Home() {
  const ai = useQuery({ ...aiStatusQuery(api), retry: false });
  return (
    <section className="page home">
      {/* On a phone, as the app: the wordmark on the left, then the Coach and the notifications. From
          600 px the wordmark is centred and those two live in the rail. */}
      <div className="titlebar">
        <span className="homemark" aria-hidden="true">
          <Wordmark height="1.1rem" />
        </span>
        <h1>{t('nav.home')}</h1>
        {ai.data?.available && ai.data.enabled && (
          <Link to="/coach" className="iconbtn phone-only" aria-label={t('nav.coach')} title={t('nav.coach')}>
            <MaterialIcon name="wand_stars" />
          </Link>
        )}
        <Link
          to="/notifications"
          className="iconbtn phone-only"
          aria-label={t('home.notifications')}
          title={t('home.notifications')}
        >
          <MaterialIcon name="notifications" />
        </Link>
      </div>
      {/* One column at every size: the week across the full width, then the last day, the last seven
          days in one card, and the metrics in one row where there is room. */}
      <div className="homegrid">
        <div className="h-week">
          <WeekHeader footer={<UsualWeek />} />
        </div>
        <div className="h-day">
          <LastDay />
        </div>
        <div className="h-last">
          <LastSevenDays />
        </div>
        <div className="h-metrics">
          <Metrics />
        </div>
      </div>
    </section>
  );
}
