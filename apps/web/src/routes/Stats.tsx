import {
  curvesQuery,
  efficiencyQuery,
  engineQuery,
  monthsRange,
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
  effortShown,
  themes,
  yearColours,
  compare,
  comparisonLabels,
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
import { MaterialIcon } from '../MaterialIcon';
import { CardTitle, Menu, InfoTip } from '../ui';
import { useResolvedTheme } from '../theme';
import { localToday } from '../week/today';

const MODES = ['last12', 'year', 'month', 'all'] as const;
type Mode = (typeof MODES)[number];

/** A month counted from year 0 (so one step is always one month), and back. */
const monthIndex = (ym: string) => {
  const [y = 0, m = 1] = ym.split('-').map(Number);
  return y * 12 + m - 1;
};
const monthKey = (n: number) => `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
const monthLabel = (n: number) =>
  new Date(Math.floor(n / 12), n % 12, 15)
    .toLocaleDateString(locale, { month: 'short', year: 'numeric' })
    .replace(' de ', ' ')
    .replace('.', '');

/**
 * The period in the URL (`?period=`): `last12`, `all`, a year (`2025`) or a run of months
 * (`2025-03..2025-06`, or one month `2025-03`).
 */
function readPeriod(
  value: string | null,
  now: number,
): { mode: Mode; year: number; from: number; to: number } {
  const thisYear = Math.floor(now / 12);
  const months = /^(\d{4}-\d{2})(?:\.\.(\d{4}-\d{2}))?$/.exec(value ?? '');
  if (months) {
    const from = monthIndex(months[1] ?? '');
    const to = months[2] ? monthIndex(months[2]) : from;
    return { mode: 'month', year: Math.floor(to / 12), from: Math.min(from, to), to: Math.max(from, to) };
  }
  if (/^\d{4}$/.test(value ?? '')) return { mode: 'year', year: Number(value), from: now, to: now };
  return { mode: value === 'all' ? 'all' : 'last12', year: thisYear, from: now, to: now };
}

/**
 * Stats (OS-311, OS-321, OS-322, OS-320, OS-912), as the app's: the period right above everything (the
 * last 12 months, a year moved with arrows, a run of months from one to another, or all time), the
 * reviews and the heatmap in the header, then the charts for the period, the summary against last year
 * and the way to routes and segments. On a large screen the cards sit two by two.
 */
export function Stats() {
  const [params, setParams] = useSearchParams();
  const [today] = useState(() => new Date());
  const now = today.getFullYear() * 12 + today.getMonth();
  const years = useQuery(yearsQuery(api));
  const first = years.data?.at(-1) ?? today.getFullYear();
  const shown = readPeriod(params.get('period'), now);
  const period = useMemo(
    () =>
      shown.mode === 'month'
        ? monthsRange(shown.from, shown.to)
        : periodOf(shown.mode === 'year' ? String(shown.year) : shown.mode, today, first),
    [shown.mode, shown.from, shown.to, shown.year, today, first],
  );
  const range = { from: period.from, to: period.to };
  const prefs = usePrefs();
  const format = useMemo(() => formatters(prefs), [prefs]);
  const theme = useResolvedTheme();
  const engine = useQuery({
    ...engineQuery(api),
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });
  const go = (value: string) => setParams({ period: value }, { replace: true });
  const months = (from: number, to: number) =>
    go(from === to ? monthKey(from) : `${monthKey(from)}..${monthKey(to)}`);
  const choose = (mode: Mode) =>
    mode === 'year' ? go(String(shown.year)) : mode === 'month' ? months(shown.to, shown.to) : go(mode);
  const [reviews, setReviews] = useState(false);

  return (
    <section className="page stats">
      <div className="titlebar">
        <h1>{t('nav.stats')}</h1>
        <div className="menuwrap">
          <button
            type="button"
            className="iconbtn"
            aria-label={t('stats.reviews')}
            title={t('stats.reviews')}
            aria-expanded={reviews}
            onClick={() => setReviews(!reviews)}
          >
            <MaterialIcon name="summarize" />
          </button>
          {reviews && (
            <nav className="popmenu" aria-label={t('stats.reviews')}>
              <Link to="/review/month">{t('review.monthLink')}</Link>
              <Link to="/review/year">{t('review.yearLink')}</Link>
            </nav>
          )}
        </div>
        <Link
          to="/stats/heatmap"
          className="iconbtn"
          aria-label={t('stats.heatmap')}
          title={t('stats.heatmap')}
        >
          <MaterialIcon name="layers" />
        </Link>
      </div>
      <div className="periodbar">
        <div className="chips" role="radiogroup" aria-label={t('stats.period')}>
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              className="chip"
              role="radio"
              aria-checked={shown.mode === m}
              onClick={() => choose(m)}
            >
              {t(`stats.mode.${m}`)}
            </button>
          ))}
        </div>
        {shown.mode === 'year' && (
          <Stepper
            label={String(shown.year)}
            back={shown.year > first ? () => go(String(shown.year - 1)) : null}
            forward={shown.year < today.getFullYear() ? () => go(String(shown.year + 1)) : null}
          />
        )}
        {shown.mode === 'month' && (
          <div className="steppers">
            <Stepper
              label={monthLabel(shown.from)}
              back={shown.from > first * 12 ? () => months(shown.from - 1, shown.to) : null}
              forward={shown.from < shown.to ? () => months(shown.from + 1, shown.to) : null}
            />
            <span className="note">–</span>
            <Stepper
              label={monthLabel(shown.to)}
              back={shown.to > shown.from ? () => months(shown.from, shown.to - 1) : null}
              forward={shown.to < now ? () => months(shown.from, shown.to + 1) : null}
            />
          </div>
        )}
      </div>
      {engine.data?.running && (
        <p className="offline" role="status">
          {t('stats.recomputing', { done: engine.data.done, total: engine.data.total })}
        </p>
      )}

      <Now theme={theme} />

      <div className="statgrid">
        <FitnessSection range={range} theme={theme} />
        <Volume range={range} unit={period.unit} theme={theme} format={format} />
        <Curves range={range} theme={theme} format={format} />
        <RecordsSection range={range} theme={theme} unit={format.unit} />
        <Progress
          theme={theme}
          distanceUnit={format.unit}
          selected={shown.mode === 'year' || shown.mode === 'month' ? shown.year : today.getFullYear()}
        />
        <Efficiency range={range} />
        <CompareWithStrava theme={theme} />
      </div>
      {/* The period's figures against the year before: a table, after the charts the period changes. */}
      <Summary range={range} format={format} />

      <h2>{t('stats.links')}</h2>
      <Menu
        label={t('stats.links')}
        items={[
          { to: '/routes', icon: 'route', label: t('stats.routes') },
          { to: '/segments', icon: 'timeline', label: t('stats.segments') },
        ]}
      />
    </section>
  );
}

/** The year or month shown, with an arrow on each side; an arrow at the end of the history is off. */
function Stepper({
  label,
  back,
  forward,
}: {
  label: string;
  back: (() => void) | null;
  forward: (() => void) | null;
}) {
  return (
    <div className="stepper">
      <button
        type="button"
        className="iconbtn"
        aria-label={t('stats.previous')}
        disabled={!back}
        onClick={back ?? undefined}
      >
        <MaterialIcon name="chevron_left" />
      </button>
      <b>{label}</b>
      <button
        type="button"
        className="iconbtn"
        aria-label={t('stats.next')}
        disabled={!forward}
        onClick={forward ?? undefined}
      >
        <MaterialIcon name="chevron_right" />
      </button>
    </div>
  );
}

function Now({ theme }: { theme: ReturnType<typeof useResolvedTheme> }) {
  const [today] = useState(localToday);
  const week = useQuery(weekQuery(api, today));
  const fitness = useQuery(fitnessQuery(api, {}));
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
            <div className="ph">
              <h3>{t('stats.load')}</h3>
              <InfoTip text={t('stats.loadNote', { average: formatHoursMinutes(average) })} />
            </div>
            <p className="big num">
              {share == null ? formatHoursMinutes(week.data.this_week.moving_s) : `${share} %`}
            </p>
            <div className="meterbar" aria-hidden="true">
              <i style={{ width: `${Math.min(100, (share ?? 0) / 1.5)}%` }} />
              <b style={{ left: `${100 / 1.5}%` }} />
            </div>
          </article>
        )}
      </div>
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
  const labels = comparisonLabels(range, locale, t); // null for All: nothing to compare with
  const rows: [string, string, number, number][] = [
    [t('feed.title'), current.count.toLocaleString(locale), current.count, previous.count],
    [t('feed.stat.distance'), format.distance(current.distance_m), current.distance_m, previous.distance_m],
    [t('feed.stat.time'), formatHoursMinutes(current.moving_s), current.moving_s, previous.moving_s],
    [t('feed.stat.ascent'), format.elevation(current.ascent_m), current.ascent_m, previous.ascent_m],
    [t('home.load'), Math.round(current.load).toLocaleString(locale), current.load, previous.load],
  ];
  return (
    <section className="panel">
      <CardTitle info={t('stats.summaryNote')}>{t('stats.summaryTitle')}</CardTitle>
      {/* Each figure against the same period a year before, as the app: last year's bar, then this period's. */}
      <ul className="compare num">
        {rows.map(([label, value, now, before]) => {
          const { percent, now: mine, before: theirs } = compare(now, before);
          const tone = percent == null || percent === 0 ? '' : percent > 0 ? ' up' : ' down';
          return (
            <li key={label}>
              <span className="clabel">{label}</span>
              <b>{value}</b>
              {labels && percent ? ( // no pill when nothing changed
                <span className={`pill${tone}`}>
                  {t('stats.change', { sign: percent > 0 ? '+' : '', percent })}
                </span>
              ) : null}
              {labels && (
                <>
                  <i className="bar before" style={{ width: `${theirs * 100}%` }} />
                  <i className="bar now" style={{ width: `${mine * 100}%` }} />
                </>
              )}
            </li>
          );
        })}
      </ul>
      {labels && (
        <p className="comparekey note">
          <span>
            <i className="bar before" /> {labels[0]}
          </span>
          <span>
            <i className="bar now" /> {labels[1]}
          </span>
        </p>
      )}
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
      <CardTitle info={t('stats.fitnessNote')}>{t('stats.fitness')}</CardTitle>
      {days.length ? <FitnessChart days={days} theme={theme} /> : <p className="note">{t('stats.empty')}</p>}
    </section>
  );
}

function Volume({
  range,
  unit,
  theme,
  format,
}: {
  range: { from: string; to: string };
  unit: 'day' | 'week' | 'month' | 'year';
  theme: ReturnType<typeof useResolvedTheme>;
  format: ReturnType<typeof formatters>;
}) {
  const [metric, setMetric] = useState<'time' | 'distance'>('time');
  const volume = useQuery(volumeQuery(api, range, unit));
  const total = (volume.data ?? []).reduce(
    (s, b) => s + (metric === 'time' ? b.totals.moving_s : b.totals.distance_m),
    0,
  );
  return (
    <section className="panel">
      {/* As on the app: the choice on the title's line, the period's total on the right above the chart. */}
      <CardTitle
        right={
          <div className="seg" role="group" aria-label={t('stats.volume')}>
            <button type="button" aria-pressed={metric === 'time'} onClick={() => setMetric('time')}>
              {t('stats.hours')}
            </button>
            <button type="button" aria-pressed={metric === 'distance'} onClick={() => setMetric('distance')}>
              {t('stats.distanceUnit')}
            </button>
          </div>
        }
      >
        {t('stats.volume')}
      </CardTitle>
      {volume.data && volume.data.length > 0 && (
        <>
          <p className="cardtotal num">
            {metric === 'time'
              ? formatHoursMinutes(total)
              : `${Math.round(total / (format.unit === 'km' ? 1000 : 1609.344)).toLocaleString(locale)} ${format.unit}`}
          </p>
          <VolumeChart
            buckets={volume.data}
            metric={metric}
            unit={unit}
            theme={theme}
            distanceUnit={format.unit}
          />
        </>
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
  unit,
}: {
  range: { from: string; to: string };
  theme: ReturnType<typeof useResolvedTheme>;
  unit: 'km' | 'mi';
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
      <CardTitle>{t('stats.records')}</CardTitle>
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
            {records.data.all_time
              .filter((r) => effortShown(r.distance_key, unit))
              .map((r) => {
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
  const colours = yearColours(
    lines.data.map((l) => l.year),
    selected,
    themes[theme],
  );
  return (
    <section className="panel">
      <CardTitle info={t('stats.progressNote')}>{t('stats.progress')}</CardTitle>
      <ProgressChart lines={lines.data} selected={selected} theme={theme} distanceUnit={distanceUnit} />
      {/* In place of a legend, as the app: each year's colour and total. */}
      <ul className="rows years">
        {lines.data.map((l) => (
          <li key={l.year} className={l.year === selected ? 'on' : undefined}>
            <span>
              <i style={{ background: colours.get(l.year), opacity: l.year === selected ? 1 : 0.5 }} />
              {l.year}
            </span>
            <span className="num">
              {Math.round(
                (l.cumulative_m.at(-1) ?? 0) / (distanceUnit === 'km' ? 1000 : 1609.344),
              ).toLocaleString(locale)}{' '}
              {distanceUnit}
            </span>
          </li>
        ))}
      </ul>
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
      <div className="efficiency">
        <SparklineRow values={values} />
      </div>
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
        <InfoTip text={t('compare.help')} />
      </div>
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
