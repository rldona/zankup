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
 * Home (OS-903, OS-904), as the app's: the Coach in the header when this server has a model, then this
 * week, the last day with activities, the metrics and the last seven days. On desktop the widgets sit in
 * two columns: the week and the day on the left, the metrics and the last seven days on the right.
 */
export function Home() {
  const ai = useQuery({ ...aiStatusQuery(api), retry: false });
  return (
    <section className="page home">
      {/* On a phone, as the app: the wordmark, then the Coach and the notifications. From 600 px those
          two are in the rail and the title is enough. */}
      <div className="titlebar">
        <span className="homemark phone-only" aria-hidden="true">
          <Wordmark height="0.9rem" />
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
      <div className="homegrid">
        <div>
          <WeekHeader footer={<UsualWeek />} />
          <LastDay />
        </div>
        <div>
          {/* Where things stand now before the week in detail, which repeats This week's ground. */}
          <Metrics />
          <LastSevenDays />
        </div>
      </div>
    </section>
  );
}
