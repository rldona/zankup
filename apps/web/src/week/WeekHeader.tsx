import { formatHoursMinutes, formatters, SPORTS, weekQuery, type Sport } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { api } from '../api';
import { locale, t } from '../i18n';
import { usePrefs } from '../prefs';
import { SportGlyph } from '../SportIcon';
import { localToday } from './today';

const asSport = (value: string): Sport =>
  (SPORTS as readonly string[]).includes(value) ? (value as Sport) : 'other';

/**
 * "This week" above the feed (OS-217): the seven days with what was done on each (today marked, the
 * days still to come faded), the streak of active weeks and the week's numbers.
 */
export function WeekHeader() {
  const [today] = useState(localToday);
  const week = useQuery(weekQuery(api, today));
  const prefs = usePrefs();
  const format = useMemo(() => formatters(prefs), [prefs]);
  if (!week.data) return null;
  const { days, this_week: totals, streak_weeks: streak } = week.data;
  return (
    <section className="week" aria-labelledby="week-title">
      <div className="weekhead">
        <h2 id="week-title">{t('week.title')}</h2>
        <span className="badge streak">{t('week.streak', { count: streak })}</span>
      </div>
      <ol className="days">
        {days.map((day) => {
          const first = day.activities[0];
          const date = new Date(`${day.date}T12:00:00`);
          const label = date.toLocaleDateString(locale, { weekday: 'narrow' });
          const long = date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
          const state = day.date === today ? 'today' : day.date > today ? 'future' : '';
          return (
            <li key={day.date} className={state}>
              {first ? (
                <Link
                  to={`/activities/${first.id}`}
                  className="dot on"
                  style={{ ['--sport' as string]: `var(--${asSport(first.sport)})` }}
                  aria-label={`${long}: ${day.activities.map((a) => a.name ?? t(`sport.${asSport(a.sport)}`)).join(', ')}`}
                >
                  <SportGlyph sport={asSport(first.sport)} />
                  {day.activities.length > 1 && <b className="more">+{day.activities.length - 1}</b>}
                </Link>
              ) : (
                <span className="dot" aria-label={long} />
              )}
              <span className="dlabel">{state === 'today' ? t('week.today') : label}</span>
            </li>
          );
        })}
      </ol>
      <dl className="weeknums num">
        <div>
          <dd>{totals.count}</dd>
          <dt>{t('feed.title')}</dt>
        </div>
        <div>
          <dd>{format.distance(totals.distance_m)}</dd>
          <dt>{t('feed.stat.distance')}</dt>
        </div>
        <div>
          <dd>{formatHoursMinutes(totals.moving_s)}</dd>
          <dt>{t('feed.stat.time')}</dt>
        </div>
        <div>
          <dd>{format.elevation(totals.ascent_m)}</dd>
          <dt>{t('feed.stat.ascent')}</dt>
        </div>
      </dl>
    </section>
  );
}
