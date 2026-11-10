import { aiStatusQuery } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { api } from '../api';
import { t } from '../i18n';
import { MaterialIcon } from '../MaterialIcon';
import { WeekHeader } from '../week/WeekHeader';

/**
 * Home (OS-903, OS-904), as the app's: the Coach in the header when this server has a model, over this
 * week and the widgets.
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
      </div>
      <WeekHeader />
    </section>
  );
}
