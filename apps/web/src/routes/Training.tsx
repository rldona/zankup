import {
  calendarQuery,
  formatDuration,
  formatHoursMinutes,
  formatters,
  heatmapQuery,
  routeQuery,
  routesQuery,
  routeThumbnail,
  segmentQuery,
  segmentsQuery,
  SPORTS,
  themes,
  type CalendarDay,
  type Sport,
} from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { api } from '../api';
import { TrackMap } from '../detail/TrackMap';
import { locale, t } from '../i18n';
import { usePrefs } from '../prefs';
import { SportIcon } from '../SportIcon';
import { day } from '../stats/format';
import { useResolvedTheme } from '../theme';
import { ChartSkeleton, PageSkeleton, Pulse } from '../Skeleton';

const asSport = (value: string): Sport =>
  (SPORTS as readonly string[]).includes(value) ? (value as Sport) : 'other';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Training calendar (OS-326): a month of weeks, one bubble per activity sized by its effort and
 * coloured by sport, the form of each day and the week's totals. Click opens the activity; dragging
 * across days sums the selection.
 */
export function TrainingCalendar() {
  const [params, setParams] = useSearchParams();
  const now = new Date();
  const month = params.get('month') ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [y = now.getFullYear(), m = now.getMonth() + 1] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7)); // back to Monday
  const end = new Date(y, m, 1);
  end.setDate(end.getDate() + ((7 - ((end.getDay() + 6) % 7)) % 7));
  const days = useQuery(calendarQuery(api, { from: iso(start), to: iso(end) }));
  const prefs = usePrefs();
  const format = useMemo(() => formatters(prefs), [prefs]);
  const [selection, setSelection] = useState<[number, number] | null>(null);
  const [dragging, setDragging] = useState(false);
  const shift = (delta: number) => {
    const d = new Date(y, m - 1 + delta, 1);
    setParams(
      { month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` },
      { replace: true },
    );
    setSelection(null);
  };
  const list = days.data ?? [];
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < list.length; i += 7) weeks.push(list.slice(i, i + 7));
  const heaviest = Math.max(1, ...list.flatMap((d) => d.activities.map((a) => a.load ?? 0)));
  const total = (span: CalendarDay[]) => {
    const acts = span.flatMap((d) => d.activities);
    return `${acts.length} · ${format.distance(acts.reduce((s, a) => s + (a.distance_m ?? 0), 0))} · ${formatHoursMinutes(acts.reduce((s, a) => s + a.moving_s, 0))}`;
  };
  const selected = selection ? list.slice(Math.min(...selection), Math.max(...selection) + 1) : [];
  return (
    <section className="page calendar">
      <div className="statshead">
        <h1>{t('calendar.title')}</h1>
        <div className="actions">
          <button type="button" onClick={() => shift(-1)} aria-label={t('calendar.prev')}>
            ‹
          </button>
          <b className="month">{first.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</b>
          <button type="button" onClick={() => shift(1)} aria-label={t('calendar.next')}>
            ›
          </button>
        </div>
      </div>
      {selected.length > 1 && (
        <p className="note" role="status">
          {t('calendar.selection', { days: selected.length, summary: total(selected) })}
        </p>
      )}
      <div
        className="calgrid"
        role="grid"
        onPointerUp={() => setDragging(false)}
        onPointerLeave={() => setDragging(false)}
      >
        <div className="calrow head" role="row">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} role="columnheader">
              {new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' })}
            </span>
          ))}
          <span role="columnheader">{t('calendar.week')}</span>
        </div>
        {weeks.map((week, w) => (
          <div className="calrow" role="row" key={week[0]?.day ?? w}>
            {week.map((d, i) => {
              const index = w * 7 + i;
              const inMonth = new Date(`${d.day}T12:00:00`).getMonth() === m - 1;
              const isSelected =
                selection && index >= Math.min(...selection) && index <= Math.max(...selection);
              return (
                <div
                  key={d.day}
                  role="gridcell"
                  className={`calday${inMonth ? '' : ' out'}${isSelected ? ' sel' : ''}`}
                  onPointerDown={() => {
                    setSelection([index, index]);
                    setDragging(true);
                  }}
                  onPointerEnter={() => dragging && selection && setSelection([selection[0], index])}
                >
                  <span className="dnum">{new Date(`${d.day}T12:00:00`).getDate()}</span>
                  {d.tsb != null && (
                    <span className={`tsb ${d.tsb >= 0 ? 'pos' : 'neg'}`} title={t('stats.tsb')}>
                      {d.tsb > 0 ? '+' : ''}
                      {d.tsb.toFixed(0)}
                    </span>
                  )}
                  <span className="bubbles">
                    {d.activities.map((a) => {
                      const size = 14 + 22 * Math.sqrt((a.load ?? 10) / heaviest);
                      return (
                        <Link
                          key={a.id}
                          to={`/activities/${a.id}`}
                          className="bubble"
                          style={{
                            width: size,
                            height: size,
                            ['--sport' as string]: `var(--${asSport(a.sport)})`,
                          }}
                          title={`${a.name ?? t(`sport.${asSport(a.sport)}`)} · ${formatDuration(a.moving_s)}`}
                          aria-label={`${a.name ?? t(`sport.${asSport(a.sport)}`)} · ${formatDuration(a.moving_s)}`}
                          onPointerDown={(e) => e.stopPropagation()}
                        />
                      );
                    })}
                  </span>
                </div>
              );
            })}
            <div className="calweek num" role="gridcell">
              {total(week)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The personal heatmap (OS-310), as the app's (OS-520): every route with GPS on a map that fills the
 * screen under the title, the sports as chips centred over it and the number of routes at its foot.
 */
export function Heatmap() {
  const [params, setParams] = useSearchParams();
  const sport = params.get('sport');
  const routes = useQuery(heatmapQuery(api, {}, sport ? [sport] : undefined));
  const theme = useResolvedTheme();
  const count = routes.data?.routes.length ?? 0;
  const pick = (value: string | null) => setParams(value ? { sport: value } : {}, { replace: true });
  return (
    <section className="page heatmap">
      <div className="titlebar">
        <h1>{t('heatmap.title')}</h1>
      </div>
      <div className="heatwrap">
        {routes.isPending ? (
          <Pulse>
            <ChartSkeleton height={400} />
          </Pulse>
        ) : count > 0 ? (
          <TrackMap
            key={sport ?? ''}
            tracks={routes.data?.routes ?? []}
            colour={themes[theme].run}
            theme={theme}
            heat
            height="100%"
          />
        ) : (
          <p className="note">{t('heatmap.note')}</p>
        )}
        <div className="chips heatchips" role="group" aria-label={t('feed.sports')}>
          <button type="button" className="chip" aria-pressed={!sport} onClick={() => pick(null)}>
            {t('feed.all')}
          </button>
          {(['run', 'ride', 'walk'] as const).map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={sport === s} onClick={() => pick(s)}>
              {t(`sport.${s}`)}
            </button>
          ))}
        </div>
        {count > 0 && (
          <p className="heatcount" title={t('heatmap.note')}>
            {t('heatmap.count', { count })}
          </p>
        )}
      </div>
    </section>
  );
}

/** Routes done more than once (OS-309). */
export function RoutesList() {
  const routes = useQuery(routesQuery(api));
  const prefs = usePrefs();
  const format = useMemo(() => formatters(prefs), [prefs]);
  return (
    <section className="page">
      <h1>{t('routes.title')}</h1>
      {routes.data?.length === 0 && <p className="state">{t('routes.empty')}</p>}
      <ul className="rows">
        {routes.data?.map((r) => {
          const shape = routeThumbnail(r.route);
          return (
            <li key={r.id}>
              <Link to={`/routes/${r.id}`} className="routerow">
                <SportIcon sport={asSport(r.sport)} />
                <span>
                  <b>{r.name ?? t(`sport.${asSport(r.sport)}`)}</b>
                  <small className="note num">
                    {t('routes.times', { count: r.count })} ·{' '}
                    {r.best.distance_m ? format.distance(r.best.distance_m) : ''} · {t('routes.best')}{' '}
                    {formatDuration(r.best.moving_s)}
                  </small>
                </span>
              </Link>
              {shape && (
                <svg
                  className="thumb"
                  viewBox="0 0 88 64"
                  aria-hidden="true"
                  style={{ ['--sport' as string]: `var(--${asSport(r.sport)})` }}
                >
                  <polyline points={shape} />
                </svg>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function RouteView() {
  const id = Number(useParams().id);
  const route = useQuery({ ...routeQuery(api, id), enabled: Number.isInteger(id) });
  const theme = useResolvedTheme();
  const prefs = usePrefs();
  const format = useMemo(() => formatters(prefs), [prefs]);
  if (!route.data) return <PageSkeleton cards={2} />;
  const r = route.data;
  const fastest = Math.min(...r.activities.map((a) => a.moving_s));
  return (
    <section className="page">
      <h1>{r.name ?? t(`sport.${asSport(r.sport)}`)}</h1>
      <p className="note">{t('routes.times', { count: r.count })}</p>
      {r.route && <TrackMap tracks={[r.route]} colour={themes[theme][asSport(r.sport)]} theme={theme} />}
      <section className="panel">
        <table className="num">
          <tbody>
            {[...r.activities].reverse().map((a) => (
              <tr key={a.id}>
                <td>
                  <Link to={`/activities/${a.id}`}>{day(a.day)}</Link>
                </td>
                <td>{formatDuration(a.moving_s)}</td>
                <td>
                  {a.distance_m
                    ? format.speedFor(a.distance_m / a.moving_s, asSport(r.sport) !== 'ride')
                    : '—'}
                </td>
                <td>{a.avg_hr ?? '—'}</td>
                <td>{a.moving_s === fastest ? '🏆' : `+${formatDuration(a.moving_s - fastest)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </section>
  );
}

/** Your segments (OS-325). */
export function SegmentsList() {
  const segments = useQuery(segmentsQuery(api));
  const prefs = usePrefs();
  const format = useMemo(() => formatters(prefs), [prefs]);
  return (
    <section className="page">
      <h1>{t('segments.title')}</h1>
      {segments.data?.length === 0 && <p className="state">{t('segments.empty')}</p>}
      <ul className="rows">
        {segments.data?.map((s) => (
          <li key={s.id}>
            <Link to={`/segments/${s.id}`}>
              <b>{s.name}</b>
            </Link>
            <span className="note num">
              {format.distance(s.distance_m)} · {t('segments.efforts', { count: s.efforts })}
              {s.best_s != null && ` · ${t('routes.best')} ${formatDuration(s.best_s)}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SegmentView() {
  const id = Number(useParams().id);
  const segment = useQuery({ ...segmentQuery(api, id), enabled: Number.isInteger(id) });
  const theme = useResolvedTheme();
  const prefs = usePrefs();
  const format = useMemo(() => formatters(prefs), [prefs]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: async () => {
      await api.DELETE('/api/segments/{segment_id}', { params: { path: { segment_id: id } } });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: segmentsQuery(api).queryKey });
      void navigate('/segments', { replace: true });
    },
  });
  if (!segment.data) return <PageSkeleton cards={2} />;
  const s = segment.data;
  const best = s.best_s;
  return (
    <section className="page">
      <h1>{s.name}</h1>
      <p className="note num">
        {format.distance(s.distance_m)}
        {s.ascent_m != null && ` · +${format.elevation(s.ascent_m)}`} ·{' '}
        {t('segments.efforts', { count: s.efforts })}
      </p>
      <TrackMap tracks={[s.track]} precision={6} colour={themes[theme].accent} theme={theme} height={280} />
      <section className="panel">
        <div className="ph">
          <h2>{t('segments.history')}</h2>
        </div>
        <table className="num">
          <tbody>
            {[...s.history].reverse().map((e) => (
              <tr key={e.activity_id}>
                <td>
                  <Link to={`/activities/${e.activity_id}`}>{day(e.day)}</Link>
                </td>
                <td>{formatDuration(e.elapsed_s)}</td>
                <td>{e.avg_hr ? `${e.avg_hr} bpm` : '—'}</td>
                <td>{e.avg_power ? `${e.avg_power} W` : ''}</td>
                <td>
                  {best != null && e.elapsed_s === best
                    ? '🏆'
                    : best != null
                      ? `+${formatDuration(e.elapsed_s - best)}`
                      : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending}>
        {t('segments.delete')}
      </button>
    </section>
  );
}
