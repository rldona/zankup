/**
 * Health on the phone (OS-512), as in the PWA (OS-606): last night's sleep with its stages, today's
 * readiness, HRV, resting HR and the rest with their sources (OS-605), and the trends for 30, 90 or
 * 365 days, with the form (TSB) from training next to readiness.
 */
import {
  healthDaysQuery,
  healthNightQuery,
  relativeDay,
  type HealthDay,
  type HealthSourceName,
  type MessageKey,
} from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useApi } from '../../src/auth';
import { HealthSkeleton } from '../../src/Skeleton';
import { SleepTiles, StageLanes } from '../../src/SleepNight';
import { Chart } from '../../src/charts';
import { lastRead, readAndSend } from '../../src/healthConnect';
import { Icon, SourceIcon, SpinningIcon } from '../../src/Icon';
import { MenuButton } from '../../src/Menu';
import { locale, t } from '../../src/i18n';
import { useTheme } from '../../src/theme';
import { Button, Card, Heading, Muted, Screen, styles as ui } from '../../src/ui';

const PERIODS = ['30', '90', '365'] as const;
type Period = (typeof PERIODS)[number];

/** The phone's own calendar day, not UTC's. */
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hours = (s: number | null | undefined) => (s ? s / 3600 : 0);
const one = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 1 });
const shortDay = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
const longDay = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });

/** "Today, …" only when it is today; "Yesterday, …"; otherwise the date. */
function dayTitle(day: string): string {
  const when = relativeDay(day, isoDay(new Date()));
  if (when === 'today') return t('health.today', { day: longDay(day) });
  if (when === 'yesterday') return t('health.yesterday', { day: longDay(day) });
  const text = longDay(day);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const sourceName = (source: HealthSourceName) => t(`health.source.${source}` as MessageKey);
const from = (source: HealthSourceName, others: HealthSourceName[]) =>
  others.length
    ? t('health.fromAlso', { source: sourceName(source), others: others.map(sourceName).join(', ') })
    : t('health.from', { source: sourceName(source) });

/** Where a figure comes from: the source's mark in the widget's top-right corner (the full text for screen readers). */
function Corner({ source, label }: { source: HealthSourceName; label: string }) {
  const c = useTheme();
  return (
    <View accessible accessibilityLabel={label} style={{ position: 'absolute', top: 14, right: 14 }}>
      <SourceIcon source={source} color={c.muted} />
    </View>
  );
}

export default function HealthScreen() {
  const api = useApi();
  const c = useTheme();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<Period>('30');
  const range = useMemo(() => {
    const end = new Date();
    end.setDate(end.getDate() + 1);
    const start = new Date(end);
    start.setDate(start.getDate() - Number(period));
    return { start: isoDay(start), end: isoDay(end) };
  }, [period]);
  const days = useQuery(healthDaysQuery(api, range.start, range.end));
  // Sync: the server fetches Garmin and Google Health in the background, and this phone sends what
  // Health Connect has (when it was connected). The icon turns until the figures have been reloaded.
  const sync = useMutation({
    mutationFn: async () => {
      await api.POST('/api/wellness/sync');
      if (lastRead()) await readAndSend(api, true).catch(() => null);
      await new Promise((resolve) => setTimeout(resolve, 8000));
      await queryClient.refetchQueries({ queryKey: ['wellness'] });
    },
  });

  const list = days.data ?? [];
  const lastNight = [...list].reverse().find((d) => d.sleep);
  const latest = list.at(-1);
  const nights = list.filter((d) => d.sleep);
  // The charts run over the whole period chosen, a gap where a day has no data, so a year shows where
  // the history starts instead of stretching the last weeks across the width.
  const span = useMemo(() => {
    const byDay = new Map((days.data ?? []).map((d) => [d.day, d]));
    const out: HealthDay[] = [];
    const day = new Date(`${range.start}T00:00:00Z`);
    const last = new Date(`${range.end}T00:00:00Z`);
    for (; day < last; day.setUTCDate(day.getUTCDate() + 1)) {
      const key = day.toISOString().slice(0, 10);
      out.push(byDay.get(key) ?? ({ day: key } as HealthDay));
    }
    return out;
  }, [days.data, range]);

  return (
    <Screen
      title={t('nav.health')}
      busy={sync.isPending}
      actions={
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('health.sync')}
            accessibilityState={{ busy: sync.isPending }}
            disabled={sync.isPending}
            hitSlop={10}
            onPress={() => sync.mutate()}
          >
            <SpinningIcon
              name="sync"
              color={sync.isPending ? c.accent : c.fg}
              size={26}
              spinning={sync.isPending}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('health.settings')}
            hitSlop={10}
            onPress={() => router.push('/settings/health')}
          >
            <Icon name="settings" color={c.fg} size={24} />
          </Pressable>
          <MenuButton
            label={t('stats.period')}
            value={period}
            onChange={setPeriod}
            options={PERIODS.map((p) => ({ value: p, label: t(`health.period.${p}`) }))}
          />
        </>
      }
    >
      {sync.isError && <Muted accessibilityRole="alert">{t('common.error')}</Muted>}

      {days.isPending && <HealthSkeleton />}
      {days.isError && <Muted accessibilityRole="alert">{t('common.error')}</Muted>}
      {days.isSuccess && list.length === 0 && (
        <Card>
          <Text style={{ color: c.fg }}>{t('health.none')}</Text>
          <Button onPress={() => router.push('/settings')}>{t('health.connect')}</Button>
        </Card>
      )}

      {lastNight?.sleep && <LastNight day={lastNight} sleep={lastNight.sleep} />}
      {latest && <Today day={latest} />}

      {nights.length > 1 && (
        <>
          <Heading>{t('health.sleep')}</Heading>
          <Card>
            <Chart
              days={span.map((d) => shortDay(d.day))}
              label={t('health.sleepSummary', {
                hours: one(hours(nights.at(-1)?.sleep?.asleep_s)),
                score: nights.at(-1)?.sleep?.score ?? '–',
              })}
              layers={[
                {
                  kind: 'bars',
                  series: [
                    {
                      label: t('health.stage.deep'),
                      color: c.sleepDeep,
                      values: span.map((d) => hours(d.sleep?.deep_s)),
                    },
                    {
                      label: t('health.stage.rem'),
                      color: c.sleepRem,
                      values: span.map((d) => hours(d.sleep?.rem_s)),
                    },
                    {
                      label: t('health.stage.light'),
                      color: c.sleepLight,
                      // A night without stages shows its whole sleep as light, as in the PWA.
                      values: span.map((d) =>
                        d.sleep?.deep_s != null ? hours(d.sleep.light_s) : hours(d.sleep?.asleep_s),
                      ),
                    },
                    {
                      label: t('health.stage.awake'),
                      color: c.sleepAwake,
                      values: span.map((d) => hours(d.sleep?.awake_s)),
                    },
                  ],
                },
                {
                  kind: 'line',
                  label: t('health.score'),
                  color: c.fg,
                  values: span.map((d) => d.sleep?.score),
                  domain: [0, 100],
                },
              ]}
            />
          </Card>
        </>
      )}
      {list.length > 1 && (
        <>
          <Heading>{t('health.heart')}</Heading>
          <Card>
            <Chart
              days={span.map((d) => shortDay(d.day))}
              label={`${t('health.hrv')} ${latest?.hrv?.value.toFixed(0) ?? '–'} ms, ${t('health.restingHr')} ${latest?.resting_hr?.value.toFixed(0) ?? '–'} bpm`}
              layers={[
                {
                  kind: 'line',
                  label: `${t('health.hrv')} (ms)`,
                  color: c.hrv,
                  values: span.map((d) => d.hrv?.value),
                },
                {
                  kind: 'line',
                  label: `${t('health.restingHr')} (bpm)`,
                  color: c.zone5,
                  values: span.map((d) => d.resting_hr?.value),
                },
              ]}
            />
          </Card>
          <Heading>{t('health.readinessAndForm')}</Heading>
          <Card>
            <Chart
              days={span.map((d) => shortDay(d.day))}
              label={
                latest?.readiness
                  ? `${t('health.readiness')} ${latest.readiness.score}`
                  : t('health.noReadiness')
              }
              layers={[
                {
                  kind: 'bars',
                  series: [
                    {
                      label: t('stats.tsb'),
                      color: c.formPositive,
                      values: span.map((d) => ((d.tsb ?? 0) >= 0 ? d.tsb : null)),
                    },
                    {
                      label: `${t('stats.tsb')} < 0`,
                      color: c.formNegative,
                      values: span.map((d) => ((d.tsb ?? 0) < 0 ? d.tsb : null)),
                    },
                  ],
                },
                {
                  kind: 'line',
                  label: t('health.readiness'),
                  color: c.accent,
                  values: span.map((d) => d.readiness?.score),
                  domain: [0, 100],
                },
              ]}
            />
            <Muted>{t('health.readinessNote')}</Muted>
          </Card>
        </>
      )}
    </Screen>
  );
}

function LastNight({ day, sleep }: { day: HealthDay; sleep: NonNullable<HealthDay['sleep']> }) {
  const api = useApi();
  const c = useTheme();
  const night = useQuery(healthNightQuery(api, day.day));
  const clock = (iso: string) =>
    new Date(new Date(iso).getTime() + (sleep.utc_offset_s ?? 0) * 1000).toISOString().slice(11, 16);
  const stageColor = {
    deep: c.sleepDeep,
    rem: c.sleepRem,
    light: c.sleepLight,
    awake: c.sleepAwake,
  } as const;
  return (
    <>
      <Heading first>
        {relativeDay(day.day, isoDay(new Date())) === 'today'
          ? t('health.lastNight')
          : t('health.nightOf', { day: longDay(day.day) })}
      </Heading>
      <SleepTiles sleep={sleep} />
      <Card>
        {night.data && night.data.stages.length > 0 ? (
          <StageLanes night={night.data} sleep={sleep} colors={stageColor} />
        ) : (
          <Muted>
            {t('health.asleep')} · {clock(sleep.start_utc)}–{clock(sleep.end_utc)}
          </Muted>
        )}
        <Muted>{longDay(day.day)}</Muted>
        <Corner source={sleep.source} label={from(sleep.source, sleep.others)} />
      </Card>
    </>
  );
}

function Today({ day }: { day: HealthDay }) {
  const c = useTheme();
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
      <Heading>{dayTitle(day.day)}</Heading>
      <Card>
        <Text style={{ color: c.fg, fontWeight: '600' }}>{t('health.readiness')}</Text>
        <Text style={[ui.statValue, { color: c.fg, fontSize: 28 }]}>{r ? r.score : '–'}</Text>
        <Muted>
          {r
            ? (
                [
                  ['hrv', 'health.hrv'],
                  ['resting_hr', 'health.restingHr'],
                  ['sleep', 'health.sleep'],
                  ['form', 'stats.tsb'],
                ] as const
              )
                .filter(([k]) => r[k] != null)
                .map(([k, label]) => `${t(label)} ${r[k]}`)
                .join(' · ')
            : t('health.noReadiness')}
        </Muted>
      </Card>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {tiles.map((tile) => (
          <Card key={tile.key} style={{ flexBasis: '46%', flexGrow: 1 }}>
            <Text style={{ color: c.muted, fontSize: 12, textTransform: 'uppercase' }}>{t(tile.key)}</Text>
            <Text style={[ui.statValue, { color: c.fg, fontSize: 22 }]}>{tile.value}</Text>
            {tile.source && <Corner source={tile.source[0]} label={from(...tile.source)} />}
          </Card>
        ))}
      </View>
    </>
  );
}
