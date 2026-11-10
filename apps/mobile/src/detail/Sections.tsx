/**
 * The sections under the profile (OS-518), as in the PWA's detail: HR zones (the engine's, or from
 * max HR), best efforts, laps, splits, the route this activity belongs to and its segments, the power
 * curve against the all-time one, and the power zones.
 */
import {
  curvesQuery,
  formatDuration,
  formatters,
  timeInZones,
  ZONE_SHARES,
  zoneLimits,
  type ActivityDetail,
  type MessageKey,
  type Series,
} from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';

import { useApi } from '../auth';
import { Chart, type Layer } from '../charts';
import { t } from '../i18n';
import { useTheme, type Palette } from '../theme';
import { Card, CardTitle, Muted } from '../ui';

type Format = ReturnType<typeof formatters>;

const ZONE_COLOURS = (c: Palette) => [c.zone1, c.zone2, c.zone3, c.zone4, c.zone5];

/** A row of a table: cells spread across, the first one left-aligned. */
function Row({ cells, strong, muted }: { cells: string[]; strong?: boolean; muted?: boolean }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 4 }}>
      {cells.map((cell, i) => (
        <Text
          key={i}
          style={{
            flex: i === 0 ? 1.2 : 1,
            textAlign: i === 0 ? 'left' : 'right',
            color: muted ? c.muted : c.fg,
            fontSize: muted ? 12 : 14,
            fontWeight: strong ? '700' : '400',
            fontVariant: ['tabular-nums'],
          }}
        >
          {cell}
        </Text>
      ))}
    </View>
  );
}

/** Time in each zone: a stacked bar, then one line per zone with its range and time. */
function ZoneRows({ seconds, limits, unit }: { seconds: number[]; limits: number[]; unit: string }) {
  const c = useTheme();
  const palette = ZONE_COLOURS(c);
  // Five colours for any number of zones (power has seven): spread from the first to the last.
  const colours = seconds.map(
    (_, i) => palette[Math.round((i * 4) / Math.max(1, seconds.length - 1))] ?? c.zone5,
  );
  const total = seconds.reduce((a, b) => a + b, 0) || 1;
  return (
    <>
      <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden' }}>
        {seconds.map((s, i) => (
          <View key={i} style={{ flex: s / total, backgroundColor: colours[i] }} />
        ))}
      </View>
      {seconds.map((s, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: c.fg, width: 26, fontWeight: '700' }}>Z{i + 1}</Text>
          <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: c.line }}>
            <View
              style={{
                width: `${(s / total) * 100}%`,
                height: 6,
                borderRadius: 3,
                backgroundColor: colours[i],
              }}
            />
          </View>
          <Text
            style={{
              color: c.muted,
              fontSize: 12,
              width: 92,
              textAlign: 'right',
              fontVariant: ['tabular-nums'],
            }}
          >
            {limits[i]}
            {i < limits.length - 1 ? `–${(limits[i + 1] ?? 0) - 1}` : '+'} {unit}
          </Text>
          <Text style={{ color: c.fg, width: 56, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
            {formatDuration(s)}
          </Text>
        </View>
      ))}
    </>
  );
}

export function Zones({
  series,
  activity,
  hrMax,
  estimated,
}: {
  series: Series;
  activity: ActivityDetail;
  hrMax: number | null;
  estimated: boolean;
}) {
  if (!series.hr?.some((v) => v != null)) return null;
  const engine =
    activity.metrics?.hr_zones && activity.metrics.hr_zone_bounds
      ? { seconds: activity.metrics.hr_zones, bounds: activity.metrics.hr_zone_bounds }
      : null;
  if (!hrMax && !engine)
    return (
      <Card>
        <CardTitle>{t('activity.zones')}</CardTitle>
        <Muted>{t('activity.zonesNone')}</Muted>
      </Card>
    );
  // The engine's zones follow your zone model (OS-301); without them, share of max HR here.
  const seconds = engine?.seconds ?? timeInZones(series, hrMax ?? 190);
  const limits = engine?.bounds ?? zoneLimits(hrMax ?? 190);
  return (
    <Card>
      <CardTitle>{t('activity.zones')}</CardTitle>
      <ZoneRows seconds={seconds} limits={limits} unit="bpm" />
      {!engine && hrMax && (
        <Muted>
          {t('activity.zonesNote', {
            low: Math.round((ZONE_SHARES[0] ?? 0) * 100),
            high: Math.round((ZONE_SHARES.at(-1) ?? 0) * 100),
            hrMax,
          })}
          {estimated && ` ${t('activity.zonesEstimate', { hrMax })}`}
        </Muted>
      )}
    </Card>
  );
}

const EFFORT_KEYS = new Set([
  '400m',
  'half_mile',
  '1k',
  '1mile',
  '2mile',
  '5k',
  '10k',
  '15k',
  '10mile',
  'half_marathon',
  'marathon',
]);

export function BestEfforts({ activity, format }: { activity: ActivityDetail; format: Format }) {
  if (!activity.best_efforts.length) return null;
  return (
    <Card>
      <CardTitle>{t('activity.best')}</CardTitle>
      <Row muted cells={[t('feed.stat.distance'), t('feed.stat.time'), t('feed.stat.pace')]} />
      {activity.best_efforts.map((e) => (
        <Row
          key={e.distance_key}
          cells={[
            EFFORT_KEYS.has(e.distance_key)
              ? t(`effort.${e.distance_key}` as MessageKey)
              : format.distance(e.distance_m),
            formatDuration(e.time_s),
            format.pace(e.distance_m / e.time_s),
          ]}
        />
      ))}
    </Card>
  );
}

export function Laps({
  activity,
  format,
  pace,
}: {
  activity: ActivityDetail;
  format: Format;
  pace: boolean;
}) {
  if (activity.laps.length < 2) return null;
  const power = activity.laps.some((l) => l.avg_power);
  return (
    <Card>
      <CardTitle>{t('activity.laps')}</CardTitle>
      <Row
        muted
        cells={[
          '#',
          t('feed.stat.distance'),
          t('feed.stat.time'),
          t(pace ? 'feed.stat.pace' : 'feed.stat.speed'),
          t('feed.stat.hr'),
          ...(power ? [t('activity.power')] : []),
        ]}
      />
      {activity.laps.map((l) => (
        <Row
          key={l.idx}
          cells={[
            String(l.idx + 1),
            l.distance_m ? format.distance(l.distance_m) : '—',
            formatDuration(l.duration_s),
            l.distance_m && l.duration_s ? format.speedFor(l.distance_m / l.duration_s, pace) : '—',
            l.avg_hr ? String(l.avg_hr) : '—',
            ...(power ? [l.avg_power ? `${l.avg_power} W` : '—'] : []),
          ]}
        />
      ))}
    </Card>
  );
}

export function Splits({
  activity,
  format,
  pace,
}: {
  activity: ActivityDetail;
  format: Format;
  pace: boolean;
}) {
  const c = useTheme();
  if (activity.splits.length < 2) return null;
  const speeds = activity.splits.map((s) => (s.time_s ? s.distance_m / s.time_s : 0));
  const fastest = Math.max(...speeds) || 1;
  let covered = 0;
  return (
    <Card>
      <CardTitle>{t('activity.splits')}</CardTitle>
      {activity.splits.map((s, i) => {
        covered += s.distance_m;
        return (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 }}>
            <Text style={{ color: c.muted, width: 64, fontSize: 13, fontVariant: ['tabular-nums'] }}>
              {format.distance(covered)}
            </Text>
            <Text style={{ color: c.fg, width: 76, fontVariant: ['tabular-nums'] }}>
              {s.time_s ? format.speedFor(s.distance_m / s.time_s, pace) : '–'}
            </Text>
            <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: c.line }}>
              <View
                style={{
                  width: `${((speeds[i] ?? 0) / fastest) * 100}%`,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: c.accent,
                }}
              />
            </View>
            <Text
              style={{
                color: c.muted,
                width: 52,
                fontSize: 12,
                textAlign: 'right',
                fontVariant: ['tabular-nums'],
              }}
            >
              {s.elevation_change_m != null ? format.elevation(s.elevation_change_m) : ''}
            </Text>
            <Text
              style={{
                color: c.muted,
                width: 32,
                fontSize: 12,
                textAlign: 'right',
                fontVariant: ['tabular-nums'],
              }}
            >
              {s.avg_hr ?? ''}
            </Text>
          </View>
        );
      })}
    </Card>
  );
}

/** The route this activity repeats and the segments it went through (OS-312, OS-325). */
export function RouteAndSegments({ activity }: { activity: ActivityDetail }) {
  const c = useTheme();
  const segments = activity.segments ?? [];
  if (!activity.route_group && !segments.length) return null;
  return (
    <>
      {activity.route_group && (
        <Muted>
          {t('activity.routeRank', { count: activity.route_group.count, rank: activity.route_group.rank })}
        </Muted>
      )}
      {segments.length > 0 && (
        <Card>
          <CardTitle>{t('activity.segmentsTitle')}</CardTitle>
          {segments.map((s) => (
            <View key={s.segment_id} style={{ paddingVertical: 4 }}>
              <Text style={{ color: c.fg, fontWeight: '600' }}>{s.name}</Text>
              <Muted>
                {formatDuration(s.elapsed_s)} · {s.rank === 1 ? '🏆 ' : ''}
                {t('activity.segmentRank', { rank: s.rank, count: s.count, best: formatDuration(s.best_s) })}
              </Muted>
            </View>
          ))}
        </Card>
      )}
    </>
  );
}

/** Durations the power curve is read at, as in the PWA's chart. */
const CURVE_TICKS = [5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600];

/** The best power for each duration in this activity, against the best of all time. */
export function Power({ activity }: { activity: ActivityDetail }) {
  const api = useApi();
  const c = useTheme();
  const metrics = activity.metrics;
  const curve = metrics?.power_curve ?? [];
  const allTime = useQuery({
    ...curvesQuery(api, 'power', { from: '2000-01-01' }),
    enabled: curve.length > 0,
  });
  const zones = metrics?.power_zones;
  const bounds = metrics?.power_zone_bounds;
  const at = (points: { duration_s: number; value: number }[], d: number) =>
    points.find((p) => p.duration_s === d)?.value ?? null;
  const ticks = CURVE_TICKS.filter((d) => curve.some((p) => p.duration_s === d));
  const label = (d: number) => (d < 60 ? `${d} s` : d < 3600 ? `${d / 60} min` : `${d / 3600} h`);
  const lines = [
    ...(allTime.data
      ? [{ label: t('stats.allTime'), color: c.muted, values: ticks.map((d) => at(allTime.data, d)) }]
      : []),
    { label: t('activity.thisActivity'), color: c.ride, values: ticks.map((d) => at(curve, d)) },
  ];
  // Both lines on one scale, so the gap between them reads true.
  const top = Math.max(1, ...lines.flatMap((l) => l.values.map((v) => v ?? 0))) * 1.05;
  const curveLayers: Layer[] = lines.map((l) => ({ kind: 'line', ...l, domain: [0, top] }));
  return (
    <>
      {ticks.length > 1 && (
        <Card>
          <CardTitle>{t('activity.powerCurve')}</CardTitle>
          <Chart
            legendGap={18}
            days={ticks.map(label)}
            label={`${t('activity.powerCurve')}: ${ticks.map((d) => `${label(d)} ${Math.round(at(curve, d) ?? 0)} W`).join(', ')}`}
            layers={curveLayers}
          />
        </Card>
      )}
      {zones && bounds && (
        <Card>
          <CardTitle>{t('activity.powerZones')}</CardTitle>
          <ZoneRows seconds={zones} limits={bounds} unit="W" />
        </Card>
      )}
    </>
  );
}
