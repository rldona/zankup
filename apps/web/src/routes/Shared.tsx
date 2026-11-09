import {
  ApiError,
  formatDuration,
  formatters,
  sharedActivityQuery,
  usesPace,
  type SharedActivity,
  type Sport,
} from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useParams } from 'react-router';

import { api } from '../api';
import { Lockup } from '../Lockup';
import { locale, t } from '../i18n';
import { usePrefs } from '../prefs';
import { SportIcon } from '../SportIcon';

/**
 * A shared activity (OS-408), for anyone with the link and without an account: the summary, the
 * route without the privacy zones (if the owner chose to show it), an elevation profile, splits and
 * photos. Nothing else of the owner's is reachable from here.
 */
export function Shared() {
  const token = useParams().token ?? '';
  const shared = useQuery(sharedActivityQuery(api, token));
  if (shared.error instanceof ApiError && shared.error.status === 404) {
    return (
      <main className="placeholder">
        <Lockup />
        <p>{t('shared.gone')}</p>
      </main>
    );
  }
  if (!shared.data) {
    return (
      <main className="placeholder">
        <p>{shared.isError ? t('common.error') : t('common.loading')}</p>
      </main>
    );
  }
  return <View data={shared.data as SharedActivity} token={token} />;
}

function View({ data, token }: { data: SharedActivity; token: string }) {
  const prefs = usePrefs();
  const format = formatters(prefs);
  const sport = data.sport as Sport;
  const pace = usesPace(sport);
  const moving = data.moving_s ?? data.duration_s;
  const figures: [string, string][] = [];
  if (data.distance_m) figures.push([t('feed.stat.distance'), format.distance(data.distance_m)]);
  figures.push([t('feed.stat.time'), formatDuration(moving)]);
  if (data.distance_m && moving)
    figures.push([
      t(pace ? 'feed.stat.pace' : 'feed.stat.speed'),
      format.speedFor(data.distance_m / moving, pace),
    ]);
  if (data.ascent_m) figures.push([t('feed.stat.ascent'), format.elevation(data.ascent_m)]);
  if (data.avg_hr) figures.push([t('feed.stat.hr'), `${data.avg_hr} bpm`]);
  if (data.avg_power) figures.push([t('activity.power'), `${data.avg_power} W`]);
  return (
    <main className="shared page">
      <header className="dhead">
        <SportIcon sport={sport} />
        <div>
          <h1>{data.name ?? t(`sport.${sport}`)}</h1>
          <p className="csub">
            {[
              data.athlete,
              new Date(`${data.day}T12:00:00`).toLocaleDateString(locale, { dateStyle: 'long' }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </header>
      <dl className="kpis num">
        {figures.map(([label, value]) => (
          <div key={label} className="kpi">
            <dd>{value}</dd>
            <dt>{label}</dt>
          </div>
        ))}
      </dl>
      {data.route && data.route.length > 0 && (
        <section className="panel">
          <RouteDrawing route={data.route as [number, number][][]} sport={sport} />
          <p className="note">{t('shared.privacy')}</p>
        </section>
      )}
      {data.profile.some((p) => p.altitude_m != null) && (
        <section className="panel">
          <h2>{t('shared.elevation')}</h2>
          <ElevationDrawing profile={data.profile} />
        </section>
      )}
      {data.photos.length > 0 && (
        <section className="panel">
          <ul className="gallery">
            {data.photos.map((p) => (
              <li key={p.id}>
                <a href={`/api/public/shares/${token}/photos/${p.id}`} target="_blank" rel="noreferrer">
                  <img
                    src={`/api/public/shares/${token}/photos/${p.id}?thumb=true`}
                    alt={p.caption ?? ''}
                    loading="lazy"
                    width={p.width}
                    height={p.height}
                  />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.splits.length > 1 && (
        <section className="panel">
          <h2>{t('activity.splits')}</h2>
          <table className="num">
            <thead>
              <tr>
                <th>{t('feed.stat.distance')}</th>
                <th>{t(pace ? 'feed.stat.pace' : 'feed.stat.speed')}</th>
                <th>{t('feed.stat.ascent')}</th>
              </tr>
            </thead>
            <tbody>
              {data.splits.map((s, i) => (
                <tr key={i}>
                  <td>
                    {format.distance(data.splits.slice(0, i + 1).reduce((sum, x) => sum + x.distance_m, 0))}
                  </td>
                  <td>{s.time_s ? format.speedFor(s.distance_m / s.time_s, pace) : '–'}</td>
                  <td>{s.elevation_change_m != null ? format.elevation(s.elevation_change_m) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <footer className="note shared-foot">
        <Lockup />
        {data.expires_at && (
          <span>{t('shared.until', { date: new Date(data.expires_at).toLocaleDateString(locale) })}</span>
        )}
      </footer>
    </main>
  );
}

function RouteDrawing({ route, sport }: { route: [number, number][][]; sport: Sport }) {
  const paths = useMemo(() => {
    const all = route.flat();
    const lat0 = all.reduce((s, p) => s + p[0], 0) / all.length;
    const k = Math.cos((lat0 * Math.PI) / 180);
    const xs = all.map((p) => p[1] * k);
    const ys = all.map((p) => p[0]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const scale = 560 / Math.max(maxX - minX, maxY - minY, 1e-9);
    const w = (maxX - minX) * scale;
    const h = (maxY - minY) * scale;
    return {
      w: w + 40,
      h: h + 40,
      d: route.map((s) =>
        s
          .map(
            (p, i) =>
              `${i ? 'L' : 'M'}${(20 + (p[1] * k - minX) * scale).toFixed(1)},${(20 + (maxY - p[0]) * scale).toFixed(1)}`,
          )
          .join(''),
      ),
    };
  }, [route]);
  return (
    <svg
      className="routedrawing"
      viewBox={`0 0 ${paths.w} ${paths.h}`}
      role="img"
      aria-label={t('activity.route')}
    >
      {paths.d.map((d, i) => (
        <path key={i} d={d} style={{ stroke: `var(--${sport})` }} />
      ))}
    </svg>
  );
}

function ElevationDrawing({ profile }: { profile: SharedActivity['profile'] }) {
  const points = profile.filter((p) => p.altitude_m != null) as { distance_m: number; altitude_m: number }[];
  const maxD = points[points.length - 1]?.distance_m || 1;
  const alts = points.map((p) => p.altitude_m);
  const lo = Math.min(...alts);
  const hi = Math.max(...alts);
  const d = points
    .map(
      (p, i) =>
        `${i ? 'L' : 'M'}${((p.distance_m / maxD) * 600).toFixed(1)},${(110 - ((p.altitude_m - lo) / (hi - lo || 1)) * 100).toFixed(1)}`,
    )
    .join('');
  return (
    <svg
      className="elevation"
      viewBox="0 0 600 120"
      preserveAspectRatio="none"
      role="img"
      aria-label={t('shared.elevation')}
    >
      <path d={`${d}L600,120L0,120Z`} />
    </svg>
  );
}
