import { aiStatusQuery } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { api } from '../api';
import { LastDay, LastSevenDays, Metrics, UsualWeek } from '../home/Widgets';
import { t } from '../i18n';
import { MaterialIcon } from '../MaterialIcon';
import { WeekHeader } from '../week/WeekHeader';

/**
 * Home (OS-903, OS-904), as the app's: the Coach in the header when this server has a model, then this
 * week, the last day with activities, the metrics and the last seven days. On desktop the widgets sit in
 * two columns: the week and the day on the left, the metrics and the last seven days on the right.
 */
export function Home() {
  const ai = useQuery({ ...aiStatusQuery(api), retry: false });
  return (
    <section className="page home">
      <div className="titlebar">
        <h1>{t('nav.home')}</h1>
        {ai.data?.available && ai.data.enabled && (
          <Link to="/coach" className="iconbtn" aria-label={t('nav.coach')} title={t('nav.coach')}>
            <MaterialIcon name="wand_stars" />
          </Link>
        )}
        <Link
          to="/notifications"
          className="iconbtn"
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
