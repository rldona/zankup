import { formatDuration, formatHoursMinutes, formatters, weekQuery, type MessageKey } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { api } from '../api';
import { locale, t } from '../i18n';
import { usePrefs } from '../prefs';
import { localToday } from '../week/today';

const EFFORTS: Record<string, MessageKey> = {
  '400m': 'effort.400m',
  half_mile: 'effort.half_mile',
  '1k': 'effort.1k',
  '1mile': 'effort.1mile',
  '2mile': 'effort.2mile',
  '5k': 'effort.5k',
  '10k': 'effort.10k',
  '15k': 'effort.15k',
  '10mile': 'effort.10mile',
  half_marathon: 'effort.half_marathon',
  marathon: 'effort.marathon',
};

/**
 * Stats, "Now" section (OS-217): this week against your usual, the last four weeks and recent
 * records. The cards that need the metrics engine (training status, VO₂max, FTP, goals) join in
 * phase 3, when their data exists.
 */
export function Stats() {
  const [today] = useState(localToday);
  const week = useQuery(weekQuery(api, today));
  const prefs = usePrefs();
  const format = useMemo(() => formatters(prefs), [prefs]);

  if (!week.data) return <section className="page">{<p className="state">{t('common.loading')}</p>}</section>;
  const { this_week: now, previous, records } = week.data;
  const average = previous.reduce((sum, w) => sum + w.moving_s, 0) / (previous.length || 1);
  const share = average > 0 ? Math.round((now.moving_s / average) * 100) : null;
  const four = [now, ...previous.slice(0, 3)].reverse();
  const tallest = Math.max(...four.map((w) => w.moving_s), 1);
  const day = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

  return (
    <section className="page stats">
      <h1>{t('nav.stats')}</h1>
      <h2>{t('stats.now')}</h2>
      <div className="cards">
        <article className="panel">
          <h3>{t('stats.load')}</h3>
          <p className="big num">{share == null ? formatHoursMinutes(now.moving_s) : `${share} %`}</p>
          <div className="meterbar" aria-hidden="true">
            <i style={{ width: `${Math.min(100, (share ?? 0) / 1.5)}%` }} />
            <b style={{ left: `${100 / 1.5}%` }} />
          </div>
          <p className="note">{t('stats.loadNote', { average: formatHoursMinutes(average) })}</p>
        </article>

        <article className="panel">
          <h3>{t('stats.lastWeeks')}</h3>
          <div
            className="bars"
            role="img"
            aria-label={four.map((w) => `${day(w.week_start)}: ${formatHoursMinutes(w.moving_s)}`).join(', ')}
          >
            {four.map((w) => (
              <div key={w.week_start}>
                <i style={{ height: `${(w.moving_s / tallest) * 100}%` }} />
                <span className="note num">{formatHoursMinutes(w.moving_s)}</span>
                <span className="note">{day(w.week_start)}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <h3>{t('stats.recentRecords')}</h3>
          {records.length ? (
            <table className="num">
              <tbody>
                {records.map((r) => (
                  <tr key={r.distance_key}>
                    <th scope="row">
                      {EFFORTS[r.distance_key]
                        ? t(EFFORTS[r.distance_key] as MessageKey)
                        : format.distance(r.distance_m)}
                    </th>
                    <td>{formatDuration(r.time_s)}</td>
                    <td>
                      <Link to={`/activities/${r.activity_id}`}>{day(r.date)}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="note">{t('stats.noRecords')}</p>
          )}
        </article>
      </div>
      <p className="state">{t('stats.engineSoon')}</p>
    </section>
  );
}
