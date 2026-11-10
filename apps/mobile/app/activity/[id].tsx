/**
 * Activity detail (OS-504, OS-516 to OS-518): the map with the route coloured by a metric, every
 * figure the PWA shows, one chart per series (altitude, pace or speed, heart rate, power, cadence) sharing
 * a cursor that follows the finger (synced with the map, on the UI thread), section selection saved as a segment, replay, photos, HR
 * and power zones, best efforts, laps, splits, the power curve, strength sets, editing and sharing.
 * The series come from the phone when kept (OS-505).
 */
import {
  activityQuery,
  availableMetrics,
  formatActivityDate,
  formatDuration,
  localStart,
  metricValues,
  quantile,
  RAMP,
  smooth,
  usesPace,
  type ActivityDetail,
  type Metric,
  type Series,
} from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, Text, useWindowDimensions, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { SummaryCard } from '../../src/Ai';
import { useApi } from '../../src/auth';
import { type ChartSeries, MetricChart } from '../../src/detail/MetricChart';
import { RouteMap } from '../../src/detail/RouteMap';
import { BestEfforts, Laps, Power, RouteAndSegments, Splits, Zones } from '../../src/detail/Sections';
import { Strength } from '../../src/detail/Strength';
import { EditActivity, metaLine, Photos, Replay, SaveSegment } from '../../src/detail/Tools';
import { Icon, SportIcon } from '../../src/Icon';
import { buildTrack, sectionStats, type SectionStats } from '../../src/detail/track';
import { locale, t } from '../../src/i18n';
import { streamsQuery } from '../../src/offline';
import { asSport, useFormat, useHrMax, useUnits } from '../../src/prefs';
import { webOrigin } from '../../src/links';
import { instanceUrl } from '../../src/session';
import { useTheme } from '../../src/theme';
import {
  accent,
  onAccent,
  Card,
  Choice,
  Empty,
  Heading,
  Loading,
  Muted,
  Stat,
  styles as ui,
} from '../../src/ui';

export default function ActivityScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const api = useApi();
  const activity = useQuery({ ...activityQuery(api, id), enabled: Number.isInteger(id) });
  if (activity.data) return <Detail activity={activity.data} />;
  if (activity.isError) return <Empty>{t('activity.notFound')}</Empty>;
  return <Loading />;
}

function Detail({ activity: a }: { activity: ActivityDetail }) {
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const { width } = useWindowDimensions();
  const sport = asSport(a.sport);
  const pace = usesPace(sport);
  const streams = useQuery({ ...streamsQuery(api, a.id), enabled: a.streams != null });
  const track = useMemo(() => (streams.data ? buildTrack(streams.data) : null), [streams.data]);
  const [cursorIndex, setCursorIndex] = useState(-1);
  const [section, setSection] = useState<[number, number] | null>(null);
  const [stats, setStats] = useState<SectionStats | null>(null);
  const [selecting, setSelecting] = useState(false);
  const cursor = useSharedValue(-1);
  const selection = useSharedValue<[number, number] | null>(null);
  const { hrMax, estimated } = useHrMax();
  const units = useUnits();
  const [editing, setEditing] = useState(false);
  const series = streams.data as Series | undefined;
  const metrics = useMemo(() => (series ? availableMetrics(series) : []), [series]);
  const [chosen, setChosen] = useState<Metric | null>(null);
  const metric = chosen && metrics.includes(chosen) ? chosen : (metrics[0] ?? null);
  const colouring = useMemo(() => {
    const values = series && metric ? metricValues(series, metric) : null;
    const lo = values ? quantile(values, 0.02) : null;
    const hi = values ? quantile(values, 0.98) : null;
    return values && lo != null && hi != null && hi > lo
      ? { values, range: [lo, hi] as [number, number] }
      : null;
  }, [series, metric]);
  const metricLabel = (m: Metric) =>
    t(m === 'speed' ? (pace ? 'metric.pace' : 'metric.speed') : `metric.${m}`);
  const formatMetric = (m: Metric, v: number) =>
    m === 'speed'
      ? format.speedFor(v, pace)
      : m === 'hr'
        ? `${Math.round(v)} bpm`
        : m === 'power'
          ? `${Math.round(v)} W`
          : format.elevation(v);
  const charts = useMemo(
    () => (series && track ? chartSeries(series, sport, pace, units, format, c) : []),
    // format and the colours change with the settings and the theme, both already in the keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, track, sport, pace, units, c],
  );
  const replayTo = useCallback(
    (i: number) => {
      cursor.set(i);
      setCursorIndex(i);
    },
    [cursor],
  );

  // The map cursor follows the finger through JS: one update per frame at most.
  const pending = useRef<number | null>(null);
  const onCursor = useCallback((i: number) => {
    if (pending.current == null) {
      requestAnimationFrame(() => {
        if (pending.current != null) setCursorIndex(pending.current);
        pending.current = null;
      });
    }
    pending.current = i;
  }, []);
  const onSelection = useCallback(
    (range: [number, number] | null, final: boolean) => {
      if (!track || !final) return;
      setSection(range);
      setStats(range ? sectionStats(track, range[0], range[1]) : null);
    },
    [track],
  );

  const moving = a.moving_s ?? a.duration_s;
  const m = a.metrics ?? null;
  const figures: [string, string][] = [];
  if (a.distance_m) figures.push([t('feed.stat.distance'), format.distance(a.distance_m)]);
  figures.push([t('feed.stat.time'), formatDuration(moving)]);
  if (a.moving_s && a.duration_s - a.moving_s > 60)
    figures.push([t('activity.elapsed'), formatDuration(a.duration_s)]);
  if (a.distance_m && moving)
    figures.push([
      t(pace ? 'feed.stat.pace' : 'feed.stat.speed'),
      format.speedFor(a.distance_m / moving, pace),
    ]);
  if (a.ascent_m) figures.push([t('feed.stat.ascent'), format.elevation(a.ascent_m)]);
  if (a.avg_hr) figures.push([t('feed.stat.hr'), `${a.avg_hr} bpm`]);
  if (a.max_hr) figures.push([t('activity.maxHr'), `${a.max_hr} bpm`]);
  if (a.avg_power) figures.push([t('activity.power'), `${a.avg_power} W`]);
  if (a.normalized_power) figures.push([t('activity.np'), `${a.normalized_power} W`]);
  if (m?.trimp != null) figures.push([t('activity.effort'), Math.round(m.trimp).toLocaleString(locale)]);
  if (pace && m?.gap_speed) figures.push([t('activity.gap'), format.pace(m.gap_speed)]);
  const kcal = a.calories ?? m?.calories;
  if (kcal)
    figures.push([
      t('activity.calories'),
      `${Math.round(kcal).toLocaleString(locale)} kcal${a.calories == null ? ` (${t('activity.estimated')})` : ''}`,
    ]);
  if (m?.decoupling != null)
    figures.push([
      t('activity.decoupling'),
      `${m.decoupling.toLocaleString(locale, { maximumFractionDigits: 1 })} %`,
    ]);
  if (a.training_effect)
    figures.push([t('activity.te'), a.training_effect.toLocaleString(locale, { maximumFractionDigits: 1 })]);
  const meta = metaLine(a, units);

  const share = async () => {
    const { data } = await api.POST('/api/activities/{activity_id}/shares', {
      params: { path: { activity_id: a.id } },
      body: { days: 7, show_map: true },
    });
    if (!data?.path) return;
    const web = webOrigin(instanceUrl() ?? '');
    await Share.share({ message: `${a.name ?? ''} ${web}${data.path}`.trim() });
  };

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ paddingBottom: 32 }}>
      <Stack.Screen
        options={{
          title: a.name ?? t(`sport.${sport}`),
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 20, alignItems: 'center' }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('activity.edit')}
                hitSlop={10}
                onPress={() => setEditing(true)}
              >
                <Icon name="edit" color={c.fg} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('activity.share')}
                hitSlop={10}
                onPress={() => void share()}
              >
                <Icon name="share" color={c.fg} />
              </Pressable>
            </View>
          ),
        }}
      />
      {track?.hasGps && (
        <View style={{ height: 300 }}>
          <RouteMap
            track={track}
            bbox={a.bbox ?? null}
            cursor={cursorIndex}
            section={section}
            dark={c.scheme === 'dark'}
            colors={{ route: c[sport], section: String(c.accent), cursor: c[sport] }}
            values={colouring?.values}
            range={colouring?.range}
          />
        </View>
      )}
      <View style={ui.page}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
          <SportIcon sport={sport} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.fg, fontSize: 22, fontWeight: '700' }}>
              {a.name ?? t(`sport.${sport}`)}
            </Text>
            <Muted>
              {formatActivityDate(localStart(a.start_utc, a.timezone), locale)}
              {a.device ? ` · ${a.device}` : ''}
            </Muted>
            {meta ? <Muted>{meta}</Muted> : null}
          </View>
        </View>
        {track?.hasGps && metrics.length > 1 && (
          <View style={{ gap: 6 }}>
            <Choice
              label={t('activity.colourBy')}
              value={metric ?? 'speed'}
              onChange={setChosen}
              options={metrics.map((x) => ({ value: x, label: metricLabel(x) }))}
            />
            {colouring && metric && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} accessible={false}>
                <Muted>
                  {formatMetric(metric, pace && metric === 'speed' ? colouring.range[1] : colouring.range[0])}
                </Muted>
                <View
                  style={{ flex: 1, flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden' }}
                >
                  {(pace && metric === 'speed' ? [...RAMP].reverse() : RAMP).map((colour) => (
                    <View key={colour} style={{ flex: 1, backgroundColor: colour }} />
                  ))}
                </View>
                <Muted>
                  {formatMetric(metric, pace && metric === 'speed' ? colouring.range[0] : colouring.range[1])}
                </Muted>
              </View>
            )}
          </View>
        )}
        {track?.hasGps && track.n > 1 && <Replay times={track.t} onIndex={replayTo} />}
        <View style={ui.stats}>
          {figures.map(([label, value]) => (
            <Stat key={label} label={label} value={value} />
          ))}
        </View>
        <SummaryCard activityId={a.id} />
        {track && track.n > 1 && (
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Heading>{t('activity.profile')}</Heading>
              <Pressable
                onPress={() => setSelecting((v) => !v)}
                accessibilityRole="switch"
                accessibilityState={{ checked: selecting }}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: selecting ? accent(c) : c.surface2,
                }}
              >
                <Text style={{ color: selecting ? onAccent(c) : c.fg, fontWeight: '600' }}>
                  {t('mobile.selectSection')}
                </Text>
              </Pressable>
            </View>
            {charts.map((chart) => (
              <MetricChart
                key={chart.label}
                track={track}
                series={chart}
                width={width - 60}
                height={110}
                cursor={cursor}
                selection={selection}
                selecting={selecting}
                onCursor={onCursor}
                onSelection={onSelection}
                unit={units === 'imperial' ? 1609.344 : 1000}
                unitLabel={units === 'imperial' ? 'mi' : 'km'}
                colors={{
                  cursor: c.fg,
                  band: `${String(c.accent)}33`,
                  grid: c.line,
                  muted: c.muted,
                  fg: c.fg,
                }}
              />
            ))}
            {stats && (
              <View style={ui.stats}>
                <Stat label={t('feed.stat.distance')} value={format.distance(stats.distance)} />
                <Stat label={t('feed.stat.time')} value={formatDuration(stats.time)} />
                <Stat
                  label={t(pace ? 'feed.stat.pace' : 'feed.stat.speed')}
                  value={
                    stats.distance > 0 ? format.speedFor(stats.distance / Math.max(stats.time, 1), pace) : '–'
                  }
                />
                <Stat label={t('feed.stat.ascent')} value={format.elevation(stats.ascent)} />
                {stats.avgHr != null && (
                  <Stat label={t('feed.stat.hr')} value={`${Math.round(stats.avgHr)} bpm`} />
                )}
              </View>
            )}
            {section && track.hasGps && <SaveSegment activityId={a.id} section={section} />}
          </Card>
        )}
        <Photos activity={a} />
        {/* On a ride, heart-rate zones follow the power curve and zones. */}
        {series && sport !== 'ride' && (
          <Zones series={series} activity={a} hrMax={hrMax} estimated={estimated} />
        )}
        {(a.sets ?? []).length > 0 && <Strength sets={a.sets} />}
        <RouteAndSegments activity={a} />
        <Power activity={a} />
        {series && sport === 'ride' && (
          <Zones series={series} activity={a} hrMax={hrMax} estimated={estimated} />
        )}
        <BestEfforts activity={a} format={format} />
        <Laps activity={a} format={format} pace={pace} />
        <Splits activity={a} format={format} pace={pace} />
        {a.description ? (
          <Card>
            <Text style={{ color: c.fg }}>{a.description}</Text>
          </Card>
        ) : null}
      </View>
      {editing && <EditActivity activity={a} onClose={() => setEditing(false)} />}
    </ScrollView>
  );
}

type Format = ReturnType<typeof useFormat>;

/** The charts an activity has data for, each in the unit it is read in: speed (or pace), cadence, power, heart rate, altitude. */
function chartSeries(
  series: Series,
  sport: ReturnType<typeof asSport>,
  pace: boolean,
  units: 'metric' | 'imperial',
  format: Format,
  c: ReturnType<typeof useTheme>,
): ChartSeries[] {
  const has = (values: (number | null)[] | null | undefined): values is (number | null)[] =>
    !!values?.some((v) => v != null && v > 0);
  const average = (values: (number | null)[], text: (v: number) => string) => {
    const usable = values.filter((v): v is number => v != null && v > 0);
    return usable.length
      ? `${t('chart.average')} ${text(usable.reduce((a, b) => a + b, 0) / usable.length)}`
      : '–';
  };
  const texts = (values: (number | null)[], text: (v: number) => string) =>
    values.map((v) => (v == null ? '–' : text(v)));
  const out: ChartSeries[] = [];
  const feet = units === 'imperial' ? 3.28084 : 1;

  const alt = series.alt;
  if (alt?.some((v) => v != null)) {
    const values = alt.map((v) => (v == null ? null : v * feet));
    out.push({
      label: t('metric.alt'),
      color: String(c.muted),
      values,
      text: texts(alt, (v) => format.elevation(v)),
      average:
        format.elevation(Math.max(...alt.filter((v): v is number => v != null))) + ` ${t('chart.max')}`,
    });
  }

  const speed = metricValues(series, 'speed');
  if (has(speed)) {
    const unit = units === 'imperial' ? 1609.344 : 1000;
    const text = (v: number) => format.speedFor(v, pace);
    const moving = speed.filter((v): v is number => v != null && v > 0.5);
    const mean = moving.length ? moving.reduce((a, b) => a + b, 0) / moving.length : 0;
    out.push(
      pace
        ? {
            label: t('metric.pace'),
            color: String(c.accent),
            // Minutes per km (or mile); standing still has no pace.
            values: speed.map((v) => (v == null || v < 0.5 ? null : unit / v / 60)),
            text: texts(speed, (v) => (v < 0.5 ? '–' : text(v))),
            average: mean ? `${t('chart.average')} ${text(mean)}` : '–',
            inverted: true,
            tick: (v) => `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`,
          }
        : {
            label: t('metric.speed'),
            color: String(c.accent),
            values: speed.map((v) => (v == null ? null : (v * 3600) / unit)),
            text: texts(speed, text),
            average: mean ? `${t('chart.average')} ${text(mean)}` : '–',
            fromZero: true,
          },
    );
  }

  const hr = series.hr;
  if (has(hr)) {
    const text = (v: number) => `${Math.round(v)} bpm`;
    out.push({
      label: t('metric.hr'),
      color: c.zone5,
      values: hr,
      text: texts(hr, text),
      average: average(hr, text),
    });
  }

  const power = metricValues(series, 'power');
  if (has(power)) {
    const text = (v: number) => `${Math.round(v)} W`;
    out.push({
      label: t('metric.power'),
      color: String(c.ride),
      values: power,
      text: texts(power, text),
      average: average(series.power ?? power, text),
      fromZero: true,
    });
  }

  if (has(series.cad)) {
    const cad = smooth(series.cad);
    const per = sport === 'ride' ? 'rpm' : t('chart.spm');
    const text = (v: number) => `${Math.round(v)} ${per}`;
    out.push({
      label: t('metric.cad'),
      color: c.zone4,
      values: cad,
      text: texts(cad, text),
      average: average(series.cad, text),
    });
  }
  const order = [
    t('metric.speed'),
    t('metric.pace'),
    t('metric.cad'),
    t('metric.power'),
    t('metric.hr'),
    t('metric.alt'),
  ];
  return out.sort((x, y) => order.indexOf(x.label) - order.indexOf(y.label));
}
