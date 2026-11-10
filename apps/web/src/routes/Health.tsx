import {
  healthDaysQuery,
  healthNightQuery,
  relativeDay,
  SOURCE_ICONS,
  type HealthDay,
  type HealthSourceName,
  type MessageKey,
} from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { api } from '../api';
import { HeartChart, ReadinessChart, SleepChart } from '../health/charts';
import { sourceName } from '../health/names';
import { SleepTiles, StageLanes } from '../health/SleepNight';
import { locale, t } from '../i18n';
import { useResolvedTheme } from '../theme';
import { localToday } from '../week/today';

const PERIODS = { '30': 30, '90': 90, '365': 365 } as const;
type PeriodKey = keyof typeof PERIODS;

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function from(source: HealthSourceName, others: HealthSourceName[]) {
  return others.length
    ? t('health.fromAlso', { source: sourceName(source), others: others.map(sourceName).join(', ') })
    : t('health.from', { source: sourceName(source) });
}

/** Where a figure comes from: the source's mark in the panel's top-right corner, the full text as its title. */
function SourceMark({ source, label }: { source: HealthSourceName; label: string }) {
  const icon = SOURCE_ICONS[source];
  return (
    <svg className="source" viewBox={icon.viewBox} role="img" aria-label={label}>
      <title>{label}</title>
      <path d={icon.d} />
    </svg>
  );
}

const one = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 1 });

const longDay = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });

/**
 * Health (OS-606): last night's sleep with its stages, today's readiness, HRV, resting HR and the
 * rest, and their trends, combined with the form (TSB) from training. Each figure says which source it
 * comes from when several recorded it (OS-605).
 */
export function Health() {
  const [params, setParams] = useSearchParams();
  const period: PeriodKey =
    (params.get('days') as PeriodKey) in PERIODS ? (params.get('days') as PeriodKey) : '30';
  const [today] = useState(localToday);
  const range = useMemo(() => {
    const end = new Date(`${today}T12:00:00`);
    end.setDate(end.getDate() + 1);
    const start = new Date(end);
    start.setDate(start.getDate() - PERIODS[period]);
    return { start: isoDay(start), end: isoDay(end) };
  }, [today, period]);
  const days = useQuery(healthDaysQuery(api, range.start, range.end));
  const theme = useResolvedTheme();
  const queryClient = useQueryClient();
  const sync = useMutation({
    mutationFn: async () => (await api.POST('/api/wellness/sync')).data,
    onSuccess: () => setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['wellness'] }), 8000),
  });

  const list = days.data ?? [];
  const lastNight = [...list].reverse().find((d) => d.sleep);
  const latest = list.at(-1);

  return (
    <section className="page stats health">
      <div className="statshead">
        <h1>{t('nav.health')}</h1>
        <div className="seg" role="group" aria-label={t('stats.period')}>
          {(Object.keys(PERIODS) as PeriodKey[]).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={p === period}
              onClick={() => setParams({ days: p }, { replace: true })}
            >
              {t(`health.period.${p}` as MessageKey)}
            </button>
          ))}
        </div>
        <button type="button" disabled={sync.isPending} onClick={() => sync.mutate()}>
          {sync.isSuccess ? t('health.syncQueued') : t('health.sync')}
        </button>
      </div>

      {days.isPending && <p className="note">{t('common.loading')}</p>}
      {days.isError && <p className="warn">{t('common.error')}</p>}
      {days.isSuccess && list.length === 0 && (
        <div className="panel empty">
          <p>{t('health.none')}</p>
          <p className="note">
            <Link to="/settings#health">{t('health.connect')} ›</Link>
          </p>
        </div>
      )}

      {lastNight?.sleep && <LastNight day={lastNight} sleep={lastNight.sleep} />}
      {latest && <Today day={latest} />}

      {list.length > 1 && (
        <>
          <h2>{t('health.sleep')}</h2>
          <div className="panel">
            <SleepChart days={list} theme={theme} />
          </div>
          <h2>{t('health.heart')}</h2>
          <div className="panel">
            <HeartChart days={list} theme={theme} />
          </div>
          <h2>{t('health.readinessAndForm')}</h2>
          <div className="panel">
            <ReadinessChart days={list} theme={theme} />
            <p className="note">{t('health.readinessNote')}</p>
          </div>
        </>
      )}
      {list.length > 0 && (
        <p className="note">
          <Link to="/settings#health">{t('health.sourcesLink')} ›</Link>
        </p>
      )}
    </section>
  );
}

function LastNight({ day, sleep }: { day: HealthDay; sleep: NonNullable<HealthDay['sleep']> }) {
  const night = useQuery(healthNightQuery(api, day.day));
  const clock = (iso: string) =>
    new Date(new Date(iso).getTime() + (sleep.utc_offset_s ?? 0) * 1000).toISOString().slice(11, 16);
  return (
    <>
      <h2>
        {relativeDay(day.day, localToday()) === 'today'
          ? t('health.lastNight')
          : t('health.nightOf', { day: longDay(day.day) })}
      </h2>
      <SleepTiles sleep={sleep} />
      <article className="panel night">
        {night.data && night.data.stages.length > 0 ? (
          <StageLanes night={night.data} sleep={sleep} />
        ) : (
          <p className="note">
            {t('health.asleep')} · {clock(sleep.start_utc)}–{clock(sleep.end_utc)}
          </p>
        )}
        <p className="note">{longDay(day.day)}</p>
        <SourceMark source={sleep.source} label={from(sleep.source, sleep.others)} />
      </article>
    </>
  );
}

function Today({ day }: { day: HealthDay }) {
  const r = day.readiness;
  const tiles: { key: MessageKey; value: string; source?: [HealthSourceName, HealthSourceName[]] }[] = [];
  const add = (key: MessageKey, v: HealthDay['hrv'], format: (n: number) => string) => {
    if (v) tiles.push({ key, value: format(v.value), source: [v.source, v.others] });
  };
  add('health.hrv', day.hrv, (n) => `${n.toFixed(0)} ms`);
  add('health.restingHr', day.resting_hr, (n) => `${n.toFixed(0)} bpm`);
  add('health.spo2', day.spo2, (n) => `${one(n)} %`);
  add('health.respiration', day.respiration, (n) => `${one(n)} rpm`);
  add('health.steps', day.steps, (n) => n.toLocaleString(locale));
  return (
    <>
      <h2>
        {relativeDay(day.day, localToday()) === 'today'
          ? t('health.today', { day: longDay(day.day) })
          : relativeDay(day.day, localToday()) === 'yesterday'
            ? t('health.yesterday', { day: longDay(day.day) })
            : longDay(day.day)}
      </h2>
      <div className="cards">
        <article className="panel">
          <h3>{t('health.readiness')}</h3>
          <p className="big num">{r ? r.score : '–'}</p>
          {r ? (
            <p className="note">
              {(
                [
                  ['hrv', 'health.hrv'],
                  ['resting_hr', 'health.restingHr'],
                  ['sleep', 'health.sleep'],
                  ['form', 'stats.tsb'],
                ] as const
              )
                .filter(([k]) => r[k] != null)
                .map(([k, label]) => `${t(label)} ${r[k]}`)
                .join(' · ')}
            </p>
          ) : (
            <p className="note">{t('health.noReadiness')}</p>
          )}
        </article>
        {tiles.map((tile) => (
          <article className="panel" key={tile.key}>
            <h3>{t(tile.key)}</h3>
            <p className="big num">{tile.value}</p>
            {tile.source && <SourceMark source={tile.source[0]} label={from(...tile.source)} />}
          </article>
        ))}
      </div>
    </>
  );
}
