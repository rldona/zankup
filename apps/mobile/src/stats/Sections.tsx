/**
 * The sections of Stats (OS-519), as in the PWA (OS-311, OS-315 to OS-323): the goal card, the
 * estimates (their own screen, from You), the events' wording (Notifications), then for the period the summary
 * against last year, fitness and form, volume by sport, best-effort curves, records with their
 * progression, the year-over-year line, aerobic efficiency and the comparison with Strava.
 */
import {
  curvesQuery,
  efficiencyQuery,
  estimatesQuery,
  fitnessQuery,
  formatDuration,
  formatHoursMinutes,
  progressQuery,
  recordsQuery,
  SPORTS,
  stravaComparisonQuery,
  summaryQuery,
  volumeQuery,
  type EstimateOut,
  type EventOut,
  type GoalOut,
  type MessageKey,
  type Sport,
  formLabel,
  weekQuery,
  yearColours,
  effortShown,
} from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useApi } from '../auth';
import { Chart, type Layer } from '../charts';
import { GoalChart } from './GoalChart';
import {
  effortName,
  ESTIMATE_ORDER,
  estimateName,
  estimateValue,
  methodText,
  RACES,
  shortDay,
} from '../estimates';
import { Icon } from '../Icon';
import { locale, t } from '../i18n';
import { asSport, useFormat } from '../prefs';
import { useTheme } from '../theme';
import { Card, CardTitle, Choice, Heading, Muted, ProgressBar, Stat, styles as ui } from '../ui';

type Format = ReturnType<typeof useFormat>;
export type Range = { from: string; to: string };

const open = (id: number) => router.push(`/activity/${id}`);

/** A pressable line of text that opens an activity. */
function ActivityLink({ id, children }: { id: number; children: string }) {
  const c = useTheme();
  return (
    <Text accessibilityRole="link" onPress={() => open(id)} style={{ color: c.accent, fontWeight: '600' }}>
      {children}
    </Text>
  );
}

// --- now ------------------------------------------------------------------------------------------

function goalValue(goal: { metric: string }, value: number, format: Format): string {
  if (goal.metric === 'distance') return format.distance(value);
  if (goal.metric === 'time') return formatHoursMinutes(value);
  return value.toLocaleString(locale, { maximumFractionDigits: 1 });
}

export function GoalCard({
  goal,
  format,
  children,
}: {
  goal: GoalOut;
  format: Format;
  children?: React.ReactNode;
}) {
  const c = useTheme();
  const share = Math.min(1, goal.current / goal.target);
  const done = goal.current >= goal.target;
  const [chart, setChart] = useState(false);
  return (
    <Card>
      {/* The whole card opens and closes the day-by-day chart, folded at first. The chart itself sits
          outside the touch area, so reading it with a finger never folds it. */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: chart }}
        accessibilityHint={t(chart ? 'goals.hideChart' : 'goals.showChart')}
        onPress={() => setChart(!chart)}
        style={({ pressed }) => ({ gap: 8, opacity: pressed ? 0.7 : 1 })}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: c.fg, fontWeight: '700' }}>
            {t(`goals.period.${goal.period}` as MessageKey)} ·{' '}
            {goal.sport ? t(`sport.${asSport(goal.sport)}`) : t('goals.allSports')}
          </Text>
          <Text style={{ color: c.fg, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
            {Math.round(share * 100)} %
          </Text>
        </View>
        <ProgressBar value={share} max={1} label={t('goals.target')} />
        <Text style={{ color: c.fg, fontVariant: ['tabular-nums'] }}>
          <Text style={{ fontWeight: '700' }}>{goalValue(goal, goal.current, format)}</Text> /{' '}
          {goalValue(goal, goal.target, format)}
        </Text>
        {/* Nothing done yet: no projection to speak of. */}
        {(done || goal.current > 0) && (
          <Muted>
            {done
              ? t('goals.done')
              : t(goal.projection >= goal.target ? 'goals.onTrack' : 'goals.behind', {
                  projection: goalValue(goal, goal.projection, format),
                })}
          </Muted>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={{ color: c.accent, fontWeight: '600' }}>
            {t(chart ? 'goals.hideChart' : 'goals.showChart')}
          </Text>
          <Icon
            name={chart ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
            color={String(c.accent)}
            size={20}
          />
        </View>
      </Pressable>
      {chart && (
        // Some room between the figures above and the chart.
        <View style={{ marginTop: 12 }}>
          <GoalChart
            goal={goal}
            value={(v) => goalValue(goal, v, format)}
            tick={(v) =>
              goal.metric === 'distance'
                ? `${Math.round(v / (format.unit === 'km' ? 1000 : 1609.344))} ${format.unit}`
                : goal.metric === 'time'
                  ? `${Math.round(v / 3600)} h`
                  : String(Math.round(v))
            }
          />
        </View>
      )}
      {/* The edit and delete buttons, with the same room above. */}
      {children ? <View style={{ marginTop: 12 }}>{children}</View> : null}
    </Card>
  );
}

export function eventText(e: EventOut, format: Format): string {
  const p = e.payload as Record<string, unknown>;
  if (e.kind === 'record')
    return t('event.record', {
      distance: effortName(String(p.distance_key)),
      time: formatDuration(Number(p.time_s)),
    });
  if (e.kind === 'estimate_up')
    return t('event.estimate_up', {
      kind: estimateName(String(p.kind)),
      value: estimateValue(String(p.kind), Number(p.value), format),
    });
  if (e.kind === 'ramp') return t('event.ramp', { ramp: String(p.ramp) });
  return e.kind;
}

export function Estimates() {
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const estimates = useQuery(estimatesQuery(api));
  if (!estimates.data) return null;
  if (!estimates.data.length)
    return (
      <Card>
        <CardTitle>{t('stats.estimates')}</CardTitle>
        <Muted>{t('stats.estimatesEmpty')}</Muted>
      </Card>
    );
  const by = new Map(estimates.data.map((e) => [e.kind, e]));
  const main = ESTIMATE_ORDER.flatMap((k) => (by.get(k) ? [by.get(k) as EstimateOut] : []));
  const races = RACES.flatMap((k) => (by.get(k) ? [by.get(k) as EstimateOut] : []));
  return (
    <>
      <Heading>{t('stats.estimates')}</Heading>
      {main.map((e) => (
        <Card key={e.kind}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 12,
            }}
          >
            <Text style={{ color: c.fg, fontSize: 17, fontWeight: '700' }}>{estimateName(e.kind)}</Text>
            <Text style={[ui.statValue, { color: c.fg, fontSize: 22 }]}>
              {estimateValue(e.kind, e.value, format)}
            </Text>
          </View>
          {e.history.length > 1 && (
            <Chart
              legendGap={18}
              height={48}
              days={[]}
              label={estimateName(e.kind)}
              layers={[
                {
                  kind: 'line',
                  label: estimateName(e.kind),
                  color: c.accent,
                  values: e.history.map((h) => h.value),
                  hideLegend: true,
                },
              ]}
            />
          )}
          <Muted>
            {methodText(e.method)}
            {e.sources.length > 0 && ': '}
            {e.sources.map((s, i) => (
              <Text key={s.id}>
                {i > 0 && ', '}
                <ActivityLink id={s.id}>{shortDay(s.day)}</ActivityLink>
              </Text>
            ))}
          </Muted>
        </Card>
      ))}
      {races.length > 0 && (
        <Card>
          <CardTitle>{t('stats.predictions')}</CardTitle>
          <Muted>{methodText(races[0]?.method ?? '')}</Muted>
          <View style={ui.stats}>
            {races.map((r) => (
              <Stat key={r.kind} label={estimateName(r.kind)} value={formatDuration(r.value)} />
            ))}
          </View>
        </Card>
      )}
    </>
  );
}

// --- the period ----------------------------------------------------------------------------------

export function Summary({ range }: { range: Range }) {
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const summary = useQuery(summaryQuery(api, range));
  if (!summary.data) return null;
  const { current, previous } = summary.data;
  const change = (now: number, before: number) => {
    if (!before) return t('stats.noPrevious');
    const percent = Math.round(((now - before) / before) * 100);
    return t('stats.vsLastYear', { sign: percent > 0 ? '+' : '', percent });
  };
  const rows: [string, string, string][] = [
    [t('feed.title'), current.count.toLocaleString(locale), change(current.count, previous.count)],
    [
      t('feed.stat.distance'),
      format.distance(current.distance_m),
      change(current.distance_m, previous.distance_m),
    ],
    [t('feed.stat.time'), formatHoursMinutes(current.moving_s), change(current.moving_s, previous.moving_s)],
    [t('feed.stat.ascent'), format.elevation(current.ascent_m), change(current.ascent_m, previous.ascent_m)],
    [t('stats.load'), Math.round(current.load).toLocaleString(locale), change(current.load, previous.load)],
  ];
  return (
    <Card>
      <CardTitle>{t('stats.summaryTitle')}</CardTitle>
      {rows.map(([label, value, delta]) => (
        <View key={label} style={{ paddingVertical: 3 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Muted>{label}</Muted>
            <Text style={[ui.statValue, { color: c.fg }]}>{value}</Text>
          </View>
          <Muted style={{ fontSize: 12 }}>{delta}</Muted>
        </View>
      ))}
    </Card>
  );
}

const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

export function Fitness({ range }: { range: Range }) {
  const api = useApi();
  const c = useTheme();
  const fitness = useQuery(fitnessQuery(api, range));
  const days = fitness.data ?? [];
  const top = Math.max(1, ...days.flatMap((d) => [d.ctl, d.atl])) * 1.05;
  return (
    <Card>
      <CardTitle>{t('stats.fitness')}</CardTitle>
      {days.length > 1 ? (
        <Chart
          legendGap={18}
          days={days.map((d) => dayLabel(d.day))}
          label={`${t('stats.ctl')} ${days.at(-1)?.ctl.toFixed(0)}, ${t('stats.atl')} ${days.at(-1)?.atl.toFixed(0)}, ${t('stats.tsb')} ${days.at(-1)?.tsb.toFixed(0)}`}
          height={180}
          layers={[
            {
              kind: 'bars',
              series: [
                {
                  label: t('stats.tsb'),
                  color: c.formPositive,
                  values: days.map((d) => (d.tsb >= 0 ? d.tsb : null)),
                },
                {
                  label: `${t('stats.tsb')} < 0`,
                  color: c.formNegative,
                  values: days.map((d) => (d.tsb < 0 ? d.tsb : null)),
                },
              ],
            },
            {
              kind: 'line',
              label: t('stats.ctl'),
              color: c.accent,
              values: days.map((d) => d.ctl),
              domain: [0, top],
            },
            {
              kind: 'line',
              label: t('stats.atl'),
              color: c.zone5,
              values: days.map((d) => d.atl),
              domain: [0, top],
              width: 1.2,
            },
          ]}
        />
      ) : (
        <Muted>{t('stats.empty')}</Muted>
      )}
      <Muted>{t('stats.fitnessNote')}</Muted>
    </Card>
  );
}

const sportOrder = (s: string) => {
  const i = (SPORTS as readonly string[]).indexOf(s);
  return i < 0 ? SPORTS.length : i;
};

export function Volume({ range, unit }: { range: Range; unit: 'day' | 'week' | 'month' | 'year' }) {
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const [metric, setMetric] = useState<'time' | 'distance'>('time');
  const volume = useQuery(volumeQuery(api, range, unit));
  const buckets = volume.data ?? [];
  const sports = [...new Set(buckets.flatMap((b) => Object.keys(b.by_sport)))].sort(
    (a, b) => sportOrder(a) - sportOrder(b),
  );
  const scale = format.unit === 'km' ? 1000 : 1609.344;
  const label = (start: string) => {
    const d = new Date(`${start}T12:00:00`);
    if (unit === 'year') return String(d.getFullYear());
    if (unit === 'month') return d.toLocaleDateString(locale, { month: 'short', year: '2-digit' });
    return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  };
  const total = buckets.reduce(
    (s, b) => s + (metric === 'time' ? b.totals.moving_s : b.totals.distance_m),
    0,
  );
  return (
    <Card>
      <CardTitle
        right={
          <Choice
            label={t('stats.volume')}
            value={metric}
            onChange={setMetric}
            options={[
              { value: 'time', label: t('stats.hours') },
              { value: 'distance', label: t('stats.distanceUnit') },
            ]}
          />
        }
      >
        {t('stats.volume')}
      </CardTitle>
      {buckets.length > 0 && (
        <>
          <Text style={[ui.statValue, { color: c.fg, alignSelf: 'flex-end' }]}>
            {metric === 'time' ? formatHoursMinutes(total) : `${(total / scale).toFixed(0)} ${format.unit}`}
          </Text>
          <Chart
            legendGap={18}
            days={buckets.map((b) => label(b.start))}
            height={170}
            label={t('stats.volume')}
            layers={[
              {
                kind: 'bars',
                series: sports.map((s) => ({
                  label: t(`sport.${asSport(s)}`),
                  color: (c as unknown as Record<string, string>)[s] ?? c.muted,
                  values: buckets.map((b) => {
                    const v = b.by_sport[s];
                    if (!v) return null;
                    return metric === 'time' ? v.moving_s / 3600 : v.distance_m / scale;
                  }),
                })),
              },
            ]}
          />
        </>
      )}
    </Card>
  );
}

const DURATION_LABEL = (s: number) => (s < 60 ? `${s} s` : s < 3600 ? `${s / 60} min` : `${s / 3600} h`);

export function Curves({ range }: { range: Range }) {
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const [kind, setKind] = useState<'speed' | 'power'>('speed');
  const sport = kind === 'speed' ? ['run'] : undefined;
  const period = useQuery(curvesQuery(api, kind, range, sport));
  const all = useQuery(curvesQuery(api, kind, { from: '2000-01-01' }, sport));
  const show = (v: number) => (kind === 'power' ? `${Math.round(v)} W` : format.pace(v));
  const durations = [...new Set([...(all.data ?? []), ...(period.data ?? [])].map((p) => p.duration_s))].sort(
    (a, b) => a - b,
  );
  const at = (points: { duration_s: number; value: number }[] | undefined, d: number) =>
    points?.find((p) => p.duration_s === d)?.value ?? null;
  const lines = [
    { label: t('stats.allTime'), color: c.muted, values: durations.map((d) => at(all.data, d)) },
    {
      label: t('stats.thisPeriod'),
      color: kind === 'power' ? c.ride : c.run,
      values: durations.map((d) => at(period.data, d)),
    },
  ];
  // Scaled to this period: a few all-time spikes (GPS, sprints) would flatten everything else.
  const values = lines.flatMap((l) => l.values).filter((v): v is number => v != null);
  const mine = lines[1]?.values.filter((v): v is number => v != null) ?? [];
  const domain: [number, number] = values.length
    ? [Math.min(...values) * 0.95, Math.max(...(mine.length ? mine : values)) * 1.15]
    : [0, 1];
  const layers: Layer[] = lines.map((l) => ({ kind: 'line', ...l, domain }));
  return (
    <Card>
      <CardTitle
        right={
          <Choice
            label={t('stats.curves')}
            value={kind}
            onChange={setKind}
            options={[
              { value: 'speed', label: t('stats.pace') },
              { value: 'power', label: t('stats.power') },
            ]}
          />
        }
      >
        {t('stats.curves')}
      </CardTitle>
      {durations.length > 1 ? (
        <>
          <Chart
            legendGap={18}
            days={durations.map(DURATION_LABEL)}
            height={170}
            label={
              (period.data ?? []).map((p) => `${DURATION_LABEL(p.duration_s)} ${show(p.value)}`).join(', ') ||
              t('stats.empty')
            }
            layers={layers}
          />
          {/* The values the line cannot label: a few durations with this period's best. */}
          <View style={ui.stats}>
            {durations
              .filter((d) => [60, 300, 1200, 3600].includes(d))
              .map((d) => (
                <Stat
                  key={d}
                  label={DURATION_LABEL(d)}
                  value={at(period.data, d) != null ? show(at(period.data, d) as number) : '–'}
                />
              ))}
          </View>
        </>
      ) : (
        <Muted>{t('stats.empty')}</Muted>
      )}
    </Card>
  );
}

export function Records({ range }: { range: Range }) {
  const api = useApi();
  const c = useTheme();
  const records = useQuery(recordsQuery(api, range));
  const format = useFormat();
  const [chosen, setChosen] = useState('5k');
  if (!records.data?.all_time.length) return null;
  const period = new Map(records.data.period.map((r) => [r.distance_key, r]));
  const progression = records.data.progression[chosen] ?? [];
  return (
    <Card>
      <CardTitle>{t('stats.records')}</CardTitle>
      <View style={{ flexDirection: 'row' }}>
        {[t('feed.stat.distance'), t('stats.allTime'), t('stats.recordsPeriod')].map((h, i) => (
          <Text
            key={h}
            style={{ flex: i === 1 ? 1.4 : 1, color: c.muted, fontSize: 12, textAlign: i ? 'right' : 'left' }}
          >
            {h}
          </Text>
        ))}
      </View>
      {records.data.all_time
        .filter((r) => effortShown(r.distance_key, format.unit))
        .map((r) => {
          const p = period.get(r.distance_key);
          const on = chosen === r.distance_key;
          return (
            <View
              key={r.distance_key}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}
            >
              <Text
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setChosen(r.distance_key)}
                style={{ flex: 1, color: on ? c.accent : c.fg, fontWeight: on ? '700' : '400' }}
              >
                {effortName(r.distance_key)}
              </Text>
              <Text style={{ flex: 1.4, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
                <ActivityLink id={r.activity_id}>{formatDuration(r.time_s)}</ActivityLink>
                <Text style={{ color: c.muted, fontSize: 11 }}> {shortDay(r.day)}</Text>
              </Text>
              <Text style={{ flex: 1, textAlign: 'right', color: c.fg, fontVariant: ['tabular-nums'] }}>
                {p ? <ActivityLink id={p.activity_id}>{formatDuration(p.time_s)}</ActivityLink> : '—'}
              </Text>
            </View>
          );
        })}
      {progression.length > 1 && (
        <>
          <Text style={{ color: c.fg, fontWeight: '700', marginTop: 8 }}>
            {t('stats.progression', { distance: effortName(chosen) })}
          </Text>
          <Chart
            legendGap={18}
            days={progression.map((p) => shortDay(p.day))}
            height={120}
            label={progression.map((p) => `${shortDay(p.day)} ${formatDuration(p.time_s)}`).join(', ')}
            layers={[
              {
                kind: 'line',
                label: effortName(chosen),
                color: c.run,
                // Faster is better: drawn upside down, so the line climbs as the record comes down.
                values: progression.map((p) => -p.time_s),
                hideLegend: true,
              },
            ]}
          />
          <Muted>
            {formatDuration(progression[0]?.time_s ?? 0)} → {formatDuration(progression.at(-1)?.time_s ?? 0)}
          </Muted>
        </>
      )}
    </Card>
  );
}

export function Progress({ selected }: { selected: number }) {
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const lines = useQuery(progressQuery(api));
  if (!lines.data?.length) return null;
  const scale = format.unit === 'km' ? 1000 : 1609.344;
  const top = Math.max(1, ...lines.data.map((l) => l.cumulative_m.at(-1) ?? 0)) / scale;
  const sorted = [...lines.data].sort((a, b) => (a.year === selected ? 1 : b.year === selected ? -1 : 0));
  const colours = yearColours(
    lines.data.map((l) => l.year),
    selected,
    c,
  );
  return (
    <Card>
      <CardTitle>{t('stats.progress')}</CardTitle>
      <Chart
        legendGap={18}
        days={Array.from({ length: 366 }, (_, i) =>
          new Date(2024, 0, 1 + i).toLocaleDateString(locale, { day: 'numeric', month: 'short' }),
        )}
        height={170}
        label={lines.data
          .map((l) => `${l.year}: ${Math.round((l.cumulative_m.at(-1) ?? 0) / scale)} ${format.unit}`)
          .join(', ')}
        layers={sorted.map((l) => ({
          kind: 'line',
          label: String(l.year),
          color: colours.get(l.year) ?? c.muted,
          values: l.cumulative_m.map((m) => m / scale),
          domain: [0, top * 1.05] as [number, number],
          width: l.year === selected ? 3 : 1.6,
          opacity: l.year === selected ? 1 : 0.5,
        }))}
      />
      {lines.data.map((l) => (
        <View key={l.year} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: colours.get(l.year),
              opacity: l.year === selected ? 1 : 0.5,
            }}
          />
          <Text
            style={{
              flex: 1,
              color: c.fg,
              fontWeight: l.year === selected ? '700' : '400',
            }}
          >
            {l.year}
          </Text>
          <Text style={{ color: c.fg, fontVariant: ['tabular-nums'] }}>
            {Math.round((l.cumulative_m.at(-1) ?? 0) / scale).toLocaleString(locale)} {format.unit}
          </Text>
        </View>
      ))}
      <Muted>{t('stats.progressNote')}</Muted>
    </Card>
  );
}

export function Efficiency({ range }: { range: Range }) {
  const api = useApi();
  const c = useTheme();
  const points = useQuery(efficiencyQuery(api, range));
  if (!points.data || points.data.length < 3) return null;
  const values = points.data.map((p) => p.efficiency);
  const third = Math.ceil(values.length / 3);
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const change =
    ((mean(values.slice(-third)) - mean(values.slice(0, third))) / mean(values.slice(0, third))) * 100;
  return (
    <Card>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 12,
        }}
      >
        <Heading first>{t('stats.efficiency')}</Heading>
        <Text
          style={[ui.statValue, { color: c.fg }]}
        >{`${change > 0 ? '+' : ''}${change.toFixed(1)} %`}</Text>
      </View>
      <Chart
        legendGap={18}
        days={[]}
        height={120}
        label={t('stats.efficiency')}
        layers={[{ kind: 'line', label: t('stats.efficiency'), color: c.run, values, hideLegend: true }]}
      />
      <Muted>{t('stats.efficiencyNote')}</Muted>
    </Card>
  );
}

const COMPARED = ['effort', 'grade_adjusted_distance', 'calories'] as const;

/** How our metrics compare with what Strava computed, for people who imported an export (OS-323). */
export function CompareWithStrava() {
  const api = useApi();
  const c = useTheme();
  const comparison = useQuery(stravaComparisonQuery(api));
  const [metric, setMetric] = useState<(typeof COMPARED)[number]>('effort');
  const data = comparison.data;
  if (!data || data.metrics.every((m) => m.count < 3)) return null;
  const current = data.metrics.find((m) => m.metric === metric);
  const number = (v: number | null | undefined, digits = 2) =>
    v == null ? '–' : v.toLocaleString(locale, { maximumFractionDigits: digits });
  return (
    <Card>
      <CardTitle>{t('compare.title')}</CardTitle>
      <Choice
        label={t('compare.metric')}
        value={metric}
        onChange={setMetric}
        options={COMPARED.map((m) => ({ value: m, label: t(`compare.${m}`) }))}
      />
      <Muted>{t('compare.help')}</Muted>
      {current && current.count >= 3 ? (
        <>
          <View style={ui.stats}>
            <Stat label={t('compare.count')} value={String(current.count)} />
            <Stat label="R²" value={number(current.r2, 3)} />
            <Stat label={t('compare.mae')} value={number(current.mae, 1)} />
            <Stat label={t('compare.ratio')} value={number(current.ratio, 3)} />
          </View>
          <Text style={{ color: c.fg, fontWeight: '700' }}>{t('compare.largest')}</Text>
          {current.largest.map((p) => (
            <View
              key={p.activity_id}
              style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}
            >
              <ActivityLink id={p.activity_id}>{t('compare.activity', { id: p.activity_id })}</ActivityLink>
              <Text style={{ color: c.fg, fontVariant: ['tabular-nums'] }}>
                Zankup {number(p.ours, 0)} · Strava {number(p.strava, 0)}
              </Text>
            </View>
          ))}
        </>
      ) : (
        <Muted>{t('compare.notEnough')}</Muted>
      )}
    </Card>
  );
}

export const sportColour = (c: ReturnType<typeof useTheme>, sport: string) =>
  (c as unknown as Record<string, string>)[asSport(sport) as Sport] ?? c.muted;

/**
 * "Now" (OS-919, from the PWA): today's form (TSB) with what it means and the fitness and fatigue
 * behind it, and this week's moving time against the average of the previous 12 weeks.
 */
export function Now() {
  const api = useApi();
  const c = useTheme();
  const [today] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const week = useQuery(weekQuery(api, today));
  const fitness = useQuery(fitnessQuery(api, {}));
  const now = fitness.data?.at(-1);
  const previous = week.data?.previous ?? [];
  const average = previous.length ? previous.reduce((s, w) => s + w.moving_s, 0) / previous.length : 0;
  const share = week.data && average > 0 ? Math.round((week.data.this_week.moving_s / average) * 100) : null;
  if (!now && !week.data) return null;
  return (
    <>
      <Heading>{t('stats.now')}</Heading>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {now && (
          <Card style={{ flex: 1 }}>
            <Muted>{t('stats.tsb')}</Muted>
            <Text style={[ui.statValue, { color: c.fg, fontSize: 26 }]}>
              {now.tsb > 0 ? `+${now.tsb.toFixed(0)}` : now.tsb.toFixed(0)}
            </Text>
            <Muted>
              {t(formLabel(now.tsb))} · {t('stats.ctl')} {now.ctl.toFixed(0)} · {t('stats.atl')}{' '}
              {now.atl.toFixed(0)}
            </Muted>
          </Card>
        )}
        {week.data && (
          <Card style={{ flex: 1 }}>
            <Muted>{t('stats.load')}</Muted>
            <Text style={[ui.statValue, { color: c.fg, fontSize: 26 }]}>
              {share == null ? formatHoursMinutes(week.data.this_week.moving_s) : `${share} %`}
            </Text>
            {share != null && <ProgressBar value={share} max={150} label={t('stats.load')} />}
            <Muted>{t('stats.loadNote', { average: formatHoursMinutes(average) })}</Muted>
          </Card>
        )}
      </View>
    </>
  );
}
