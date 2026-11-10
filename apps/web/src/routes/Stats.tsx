import {
  curvesQuery,
  efficiencyQuery,
  engineQuery,
  estimatesQuery,
  fitnessQuery,
  formatHoursMinutes,
  formatters,
  periodOf,
  progressQuery,
  recordsQuery,
  summaryQuery,
  volumeQuery,
  weekQuery,
  yearsQuery,
  formatDuration,
  type FitnessDay,
  stravaComparisonQuery,
  formLabel,
} from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { api } from '../api';
import { Sparkline } from '../charts/static';
import { locale, t } from '../i18n';
import { usePrefs } from '../prefs';
import {
  ComparisonChart,
  CurveChart,
  FitnessChart,
  ProgressChart,
  ProgressionChart,
  VolumeChart,
} from '../stats/charts';
import { effortName } from '../stats/format';
import { EstimatesPanel, EventsList, GoalsPanel } from '../stats/panels';
import { useResolvedTheme } from '../theme';
import { localToday } from '../week/today';

/**
 * Stats (OS-311, OS-321, OS-322, OS-320): "Now" (form today, this week, goals, estimates, what the
 * engine noticed), then everything for the chosen period: summary against last year, fitness and
 * form, volume, best-effort curves against all time, records and their progression, aerobic
 * efficiency and the year-over-year line. The period lives in the URL.
 */
export function Stats() {
  const [params, setParams] = useSearchParams();
  const choice = params.get('period') ?? 'last12';
  const [today] = useState(() => new Date());
  const years = useQuery(yearsQuery(api));
  const first = years.data?.at(-1) ?? today.getFullYear();
  const period = useMemo(() => periodOf(choice, today, first), [choice, today, first]);
  const range = { from: period.from, to: period.to };
  const prefs = usePrefs();
  const format = useMemo(() => formatters(prefs), [prefs]);
  const theme = useResolvedTheme();
  const engine = useQuery({
    ...engineQuery(api),
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });

  const months = useMemo(() => {
    if (!/^\d{4}$/.test(choice)) return [];
    const y = Number(choice);
    const last = y === today.getFullYear() ? today.getMonth() : 11;
    return Array.from({ length: last + 1 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
  }, [choice, today]);

  return (
    <section className="page stats">
      <div className="statshead">
        <h1>{t('nav.stats')}</h1>
        <label className="sortby">
          {t('stats.period')}
          <select
            value={/^\d{4}-\d{2}$/.test(choice) ? choice.slice(0, 4) : choice}
            onChange={(e) => setParams({ period: e.target.value }, { replace: true })}
          >
            <option value="last12">{t('stats.period.last12')}</option>
            <option value="all">{t('stats.period.all')}</option>
            {(years.data ?? []).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          {(months.length > 0 || /^\d{4}-\d{2}$/.test(choice)) && (
            <select
              aria-label={t('search.date')}
              value={/^\d{4}-\d{2}$/.test(choice) ? choice : ''}
              onChange={(e) => setParams({ period: e.target.value || choice.slice(0, 4) }, { replace: true })}
            >
              <option value="">—</option>
              {(months.length ? months : [choice]).map((m) => (
                <option key={m} value={m}>
                  {new Date(`${m}-15T12:00:00`).toLocaleDateString(locale, { month: 'long' })}
                </option>
              ))}
            </select>
          )}
        </label>
      </div>
      {engine.data?.running && (
        <p className="offline" role="status">
          {t('stats.recomputing', { done: engine.data.done, total: engine.data.total })}
        </p>
      )}

      <Now theme={theme} />

      <Summary range={range} format={format} />

      <FitnessSection range={range} theme={theme} />

      <Volume range={range} unit={period.unit} theme={theme} distanceUnit={format.unit} />

      <Curves range={range} theme={theme} format={format} />

      <RecordsSection range={range} theme={theme} />

      <Progress
        theme={theme}
        distanceUnit={format.unit}
        selected={Number(choice.slice(0, 4)) || today.getFullYear()}
      />

      <Efficiency range={range} />

      <CompareWithStrava theme={theme} />

      <nav className="panel statlinks" aria-label={t('stats.links')}>
        <Link to="/review/month">{t('review.monthLink')} ›</Link>
        <Link to="/review/year">{t('review.yearLink')} ›</Link>
        <Link to="/health">{t('nav.health')} ›</Link>
        <Link to="/stats/calendar">{t('stats.calendar')} ›</Link>
        <Link to="/stats/heatmap">{t('stats.heatmap')} ›</Link>
        <Link to="/routes">{t('stats.routes')} ›</Link>
        <Link to="/segments">{t('stats.segments')} ›</Link>
      </nav>
    </section>
  );
}

function Now({ theme }: { theme: ReturnType<typeof useResolvedTheme> }) {
  const [today] = useState(localToday);
  const week = useQuery(weekQuery(api, today));
  const fitness = useQuery(fitnessQuery(api, {}));
  const estimates = useQuery(estimatesQuery(api));
  const now = fitness.data?.at(-1);
  const average = week.data
    ? week.data.previous.reduce((s, w) => s + w.moving_s, 0) / (week.data.previous.length || 1)
    : 0;
  const share = week.data && average > 0 ? Math.round((week.data.this_week.moving_s / average) * 100) : null;
  void theme;
  return (
    <>
      <h2>{t('stats.now')}</h2>
      <div className="cards">
        {now && (
          <article className="panel">
            <h3>{t('stats.tsb')}</h3>
            <p className="big num">{now.tsb > 0 ? `+${now.tsb.toFixed(0)}` : now.tsb.toFixed(0)}</p>
            <p className="note">
              {t(formLabel(now.tsb))} · {t('stats.ctl')} {now.ctl.toFixed(0)} · {t('stats.atl')}{' '}
              {now.atl.toFixed(0)}
            </p>
          </article>
        )}
        {week.data && (
          <article className="panel">
            <h3>{t('stats.load')}</h3>
            <p className="big num">
              {share == null ? formatHoursMinutes(week.data.this_week.moving_s) : `${share} %`}
            </p>
            <div className="meterbar" aria-hidden="true">
              <i style={{ width: `${Math.min(100, (share ?? 0) / 1.5)}%` }} />
              <b style={{ left: `${100 / 1.5}%` }} />
            </div>
            <p className="note">{t('stats.loadNote', { average: formatHoursMinutes(average) })}</p>
          </article>
        )}
      </div>
      <GoalsPanel />
      <EventsList />
      {estimates.data && (
        <>
          <h2>{t('stats.estimates')}</h2>
          <EstimatesPanel estimates={estimates.data} />
        </>
      )}
    </>
  );
}

function Summary({
  range,
  format,
}: {
  range: { from: string; to: string };
  format: ReturnType<typeof formatters>;
}) {
  const summary = useQuery(summaryQuery(api, range));
  if (!summary.data) return null;
  const { current, previous } = summary.data;
  const change = (now: number, before: number) => {
    if (!before) return t('stats.noPrevious');
    const percent = Math.round(((now - before) / before) * 100);
    return t('stats.vsLastYear', { sign: percent > 0 ? '+' : '', percent });
  };
  return (
    <section className="panel">
      <div className="ph">
        <h2>{t('stats.summaryTitle')}</h2>
      </div>
      <dl className="kpis num">
        <div className="kpi">
          <dd>{current.count.toLocaleString(locale)}</dd>
          <dt>
            {t('feed.title')} · {change(current.count, previous.count)}
          </dt>
        </div>
        <div className="kpi">
          <dd>{format.distance(current.distance_m)}</dd>
          <dt>
            {t('feed.stat.distance')} · {change(current.distance_m, previous.distance_m)}
          </dt>
        </div>
        <div className="kpi">
          <dd>{formatHoursMinutes(current.moving_s)}</dd>
          <dt>
            {t('feed.stat.time')} · {change(current.moving_s, previous.moving_s)}
          </dt>
        </div>
        <div className="kpi">
          <dd>{format.elevation(current.ascent_m)}</dd>
          <dt>
            {t('feed.stat.ascent')} · {change(current.ascent_m, previous.ascent_m)}
          </dt>
        </div>
        <div className="kpi">
          <dd>{Math.round(current.load).toLocaleString(locale)}</dd>
          <dt>
            {t('stats.load')} · {change(current.load, previous.load)}
          </dt>
        </div>
      </dl>
    </section>
  );
}

function FitnessSection({
  range,
  theme,
}: {
  range: { from: string; to: string };
  theme: ReturnType<typeof useResolvedTheme>;
}) {
  const fitness = useQuery(fitnessQuery(api, range));
  const days: FitnessDay[] = fitness.data ?? [];
  return (
    <section className="panel">
      <div className="ph">
        <h2>{t('stats.fitness')}</h2>
      </div>
      {days.length ? <FitnessChart days={days} theme={theme} /> : <p className="note">{t('stats.empty')}</p>}
      <p className="note">{t('stats.fitnessNote')}</p>
    </section>
  );
}

function Volume({
  range,
  unit,
  theme,
  distanceUnit,
}: {
  range: { from: string; to: string };
  unit: 'day' | 'week' | 'month' | 'year';
  theme: ReturnType<typeof useResolvedTheme>;
  distanceUnit: 'km' | 'mi';
}) {
  const [metric, setMetric] = useState<'time' | 'distance'>('time');
  const volume = useQuery(volumeQuery(api, range, unit));
  return (
    <section className="panel">
      <div className="ph">
        <h2>{t('stats.volume')}</h2>
        <div className="seg" role="group" aria-label={t('stats.volume')}>
          <button type="button" aria-pressed={metric === 'time'} onClick={() => setMetric('time')}>
            {t('stats.hours')}
          </button>
          <button type="button" aria-pressed={metric === 'distance'} onClick={() => setMetric('distance')}>
            {t('stats.distanceUnit')}
          </button>
        </div>
      </div>
      {volume.data && (
        <VolumeChart
          buckets={volume.data}
          metric={metric}
          unit={unit}
          theme={theme}
          distanceUnit={distanceUnit}
        />
      )}
    </section>
  );
}

function Curves({
  range,
  theme,
  format,
}: {
  range: { from: string; to: string };
  theme: ReturnType<typeof useResolvedTheme>;
  format: ReturnType<typeof formatters>;
}) {
  const [kind, setKind] = useState<'speed' | 'power'>('speed');
  const sport = kind === 'speed' ? ['run'] : undefined;
  const period = useQuery(curvesQuery(api, kind, range, sport));
  const all = useQuery(curvesQuery(api, kind, { from: '2000-01-01' }, sport));
  const show = (v: number) => (kind === 'power' ? `${Math.round(v)} W` : format.pace(v));
  return (
    <section className="panel">
      <div className="ph">
        <h2>{t('stats.curves')}</h2>
        <div className="seg" role="group" aria-label={t('stats.curves')}>
          <button type="button" aria-pressed={kind === 'speed'} onClick={() => setKind('speed')}>
            {t('stats.pace')}
          </button>
          <button type="button" aria-pressed={kind === 'power'} onClick={() => setKind('power')}>
            {t('stats.power')}
          </button>
        </div>
      </div>
      {period.data && all.data && (
        <CurveChart
          period={period.data}
          allTime={all.data}
          theme={theme}
          format={show}
          colour={kind === 'power' ? 'var(--ride)' : 'var(--run)'}
        />
      )}
    </section>
  );
}

function RecordsSection({
  range,
  theme,
}: {
  range: { from: string; to: string };
  theme: ReturnType<typeof useResolvedTheme>;
}) {
  const records = useQuery(recordsQuery(api, range));
  const [chosen, setChosen] = useState('5k');
  if (!records.data?.all_time.length) return null;
  const period = new Map(records.data.period.map((r) => [r.distance_key, r]));
  const progression = records.data.progression[chosen] ?? [];
  const day = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  return (
    <section className="panel">
      <div className="ph">
        <h2>{t('stats.records')}</h2>
      </div>
      <div className="scroll" tabIndex={0} role="region" aria-label={t('stats.records')}>
        <table className="num">
          <thead>
            <tr>
              <th scope="col">{t('feed.stat.distance')}</th>
              <th scope="col">{t('stats.allTime')}</th>
              <th scope="col">{t('stats.recordsPeriod')}</th>
            </tr>
          </thead>
          <tbody>
            {records.data.all_time.map((r) => {
              const p = period.get(r.distance_key);
              return (
                <tr
                  key={r.distance_key}
                  aria-selected={chosen === r.distance_key}
                  onClick={() => setChosen(r.distance_key)}
                >
                  <th scope="row">
                    <button type="button" className="link" onClick={() => setChosen(r.distance_key)}>
                      {effortName(r.distance_key)}
                    </button>
                  </th>
                  <td>
                    <Link to={`/activities/${r.activity_id}`}>{formatDuration(r.time_s)}</Link>{' '}
                    <span className="note">{day(r.day)}</span>
                  </td>
                  <td>
                    {p ? <Link to={`/activities/${p.activity_id}`}>{formatDuration(p.time_s)}</Link> : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {progression.length > 1 && (
        <>
          <h3>{t('stats.progression', { distance: effortName(chosen) })}</h3>
          <ProgressionChart
            points={progression.map((p) => ({ day: p.day, time_s: p.time_s, activity_id: p.activity_id }))}
            theme={theme}
          />
        </>
      )}
    </section>
  );
}

function Progress({
  theme,
  distanceUnit,
  selected,
}: {
  theme: ReturnType<typeof useResolvedTheme>;
  distanceUnit: 'km' | 'mi';
  selected: number;
}) {
  const lines = useQuery(progressQuery(api));
  if (!lines.data?.length) return null;
  return (
    <section className="panel">
      <div className="ph">
        <h2>{t('stats.progress')}</h2>
      </div>
      <ProgressChart lines={lines.data} selected={selected} theme={theme} distanceUnit={distanceUnit} />
      <p className="note">{t('stats.progressNote')}</p>
    </section>
  );
}

function Efficiency({ range }: { range: { from: string; to: string } }) {
  const points = useQuery(efficiencyQuery(api, range));
  if (!points.data || points.data.length < 3) return null;
  const values = points.data.map((p) => p.efficiency);
  const first = values.slice(0, Math.ceil(values.length / 3));
  const last = values.slice(-Math.ceil(values.length / 3));
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const change = ((mean(last) - mean(first)) / mean(first)) * 100;
  return (
    <section className="panel">
      <div className="ph">
        <h2>{t('stats.efficiency')}</h2>
        <span className="num">{`${change > 0 ? '+' : ''}${change.toFixed(1)} %`}</span>
      </div>
      <SparklineRow values={values} />
      <p className="note">{t('stats.efficiencyNote')}</p>
    </section>
  );
}

const COMPARED = ['effort', 'grade_adjusted_distance', 'calories'] as const;

/** How our metrics compare with what Strava computed, for people who imported an export (OS-323). */
function CompareWithStrava({ theme }: { theme: ReturnType<typeof useResolvedTheme> }) {
  const comparison = useQuery(stravaComparisonQuery(api));
  const [metric, setMetric] = useState<(typeof COMPARED)[number]>('effort');
  const data = comparison.data;
  if (!data || data.metrics.every((m) => m.count < 3)) return null;
  const current = data.metrics.find((m) => m.metric === metric);
  const number = (v: number | null | undefined, digits = 2) =>
    v == null ? '–' : v.toLocaleString(locale, { maximumFractionDigits: digits });
  return (
    <section className="panel">
      <div className="ph">
        <h2>{t('compare.title')}</h2>
        <div className="seg" role="group" aria-label={t('compare.metric')}>
          {COMPARED.map((m) => (
            <button key={m} type="button" aria-pressed={m === metric} onClick={() => setMetric(m)}>
              {t(`compare.${m}`)}
            </button>
          ))}
        </div>
      </div>
      <p className="note">{t('compare.help')}</p>
      {current && current.count >= 3 ? (
        <>
          <dl className="kpis num">
            <div className="kpi">
              <dd>{current.count}</dd>
              <dt>{t('compare.count')}</dt>
            </div>
            <div className="kpi">
              <dd>{number(current.r2, 3)}</dd>
              <dt>R²</dt>
            </div>
            <div className="kpi">
              <dd>{number(current.mae, 1)}</dd>
              <dt>{t('compare.mae')}</dt>
            </div>
            <div className="kpi">
              <dd>{number(current.ratio, 3)}</dd>
              <dt>{t('compare.ratio')}</dt>
            </div>
          </dl>
          <ComparisonChart
            points={current.points}
            theme={theme}
            label={t('compare.chart', { metric: t(`compare.${metric}`) })}
          />
          <h3>{t('compare.largest')}</h3>
          <ul className="rows">
            {current.largest.map((p) => (
              <li key={p.activity_id}>
                <Link to={`/activities/${p.activity_id}`}>
                  {t('compare.activity', { id: p.activity_id })}
                </Link>
                <span className="num">
                  Zankup {number(p.ours, 0)} · Strava {number(p.strava, 0)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="state">{t('compare.notEnough')}</p>
      )}
      {metric === 'effort' && data.effort_scale && (
        <details>
          <summary>{t('compare.scale')}</summary>
          <p className="note">
            {t('compare.scaleHelp', { r2: number(data.effort_scale.r2, 3), count: data.effort_scale.count })}
          </p>
          <p className="num">
            {data.effort_scale.coefficients.map((c, i) => `Z${i + 1}: ${number(c, 3)}`).join(' · ')}
          </p>
        </details>
      )}
    </section>
  );
}

function SparklineRow({ values }: { values: number[] }) {
  return <Sparkline values={values} label={t('stats.efficiency')} />;
}
