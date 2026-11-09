/**
 * Home's widgets (OS-527): the last day with activities (a card per activity you swipe through, then that
 * day's steps, heart rate and HRV), the last seven days by sport with health averages, and the metrics
 * (VO₂ max from VDOT, FTP, today's steps, training load).
 */
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import {
  activitiesQuery,
  estimatesQuery,
  fitnessQuery,
  formatDuration,
  formatHoursMinutes,
  healthDaysQuery,
  meQuery,
  SPORT_ICONS,
  type ActivitySummary,
} from '@zankup/core';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';

import { useApi } from '../auth';
import { Thumbnail } from '../Feed';
import { Icon, type IconName } from '../Icon';
import { locale, t } from '../i18n';
import { asSport, useFormat } from '../prefs';
import { formLabel } from '../stats/Sections';
import { useTheme } from '../theme';
import { Card, Heading, Muted, styles as ui } from '../ui';
import { average, dayHeading, daysBefore, isoDay, lastDay, lastSevenDays } from './data';

type Format = ReturnType<typeof useFormat>;

const STEPS_GOAL = 10_000;

function useToday() {
  const [today] = useState(() => isoDay(new Date()));
  return today;
}

/** The health days of the last week, shared by the widgets (one request). */
function useHealthWeek(today: string) {
  const api = useApi();
  return useQuery(healthDaysQuery(api, daysBefore(today, 6), today));
}

// --- the last day -----------------------------------------------------------------------------------

export function LastDay() {
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const today = useToday();
  const feed = useInfiniteQuery(activitiesQuery(api));
  const health = useHealthWeek(today);
  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);
  const last = lastDay(items);
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  if (!last) return feed.isFetched ? <Muted>{t('home.empty')}</Muted> : null;

  const heading = dayHeading(last.day, today);
  const title =
    heading === 'date'
      ? new Date(`${last.day}T12:00:00`).toLocaleDateString(locale, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })
      : t(heading === 'today' ? 'home.today' : 'home.yesterday');
  const day = health.data?.find((d) => d.day === last.day);
  // Each page is the screen's width with the usual 16 px either side, so cards never touch while swiping.
  const pageWidth = width;

  return (
    <>
      <Heading>{title.charAt(0).toUpperCase() + title.slice(1)}</Heading>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / pageWidth))}
        style={{ marginHorizontal: -16 }}
      >
        {last.activities.map((a) => (
          <View key={a.id} style={{ width: pageWidth, paddingHorizontal: 16 }}>
            <DayActivity activity={a} format={format} />
          </View>
        ))}
      </ScrollView>
      {last.activities.length > 1 && (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
          {last.activities.map((a, i) => (
            <View
              key={a.id}
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: i === page ? c.fg : c.line,
              }}
            />
          ))}
        </View>
      )}
      {day && (day.steps || day.resting_hr || day.hrv) ? (
        <Card style={{ paddingVertical: 0, gap: 0 }}>
          {day.steps ? (
            <Row
              icon="footprint"
              tint={c.ride}
              label={t('home.steps')}
              value={Math.round(day.steps.value).toLocaleString(locale)}
              extra={<Ring value={day.steps.value} max={STEPS_GOAL} size={34} />}
            />
          ) : null}
          {day.resting_hr ? (
            <Row
              icon="favorite"
              tint={c.zone5}
              label={t('home.heartRate')}
              value={t('home.resting', { value: Math.round(day.resting_hr.value) })}
            />
          ) : null}
          {day.hrv ? (
            <Row
              icon="monitor_heart"
              tint={c.run}
              label={t('home.hrv')}
              value={`${Math.round(day.hrv.value)} ms`}
              last
            />
          ) : null}
        </Card>
      ) : null}
    </>
  );
}

function DayActivity({ activity: a, format }: { activity: ActivitySummary; format: Format }) {
  const c = useTheme();
  const sport = asSport(a.sport);
  const main = a.distance_m ? format.distance(a.distance_m) : formatDuration(a.moving_s ?? a.duration_s);
  const details = [
    a.distance_m ? formatDuration(a.moving_s ?? a.duration_s) : null,
    a.avg_power
      ? t('home.avgPower', { value: a.avg_power })
      : a.avg_hr
        ? t('home.avgHr', { value: a.avg_hr })
        : null,
  ].filter(Boolean);
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/activity/${a.id}`)}>
      <Card>
        <Text numberOfLines={1} style={{ color: c.fg, fontSize: 16, fontWeight: '600' }}>
          {a.name ?? t(`sport.${sport}`)}
        </Text>
        {/* A fixed height, with or without a route, so every card in the slider is as tall. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, height: 64 }}>
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: c[sport],
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name={SPORT_ICONS[sport]} color="#fff" size={28} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.fg, fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
              {main}
            </Text>
            {details.length > 0 && <Muted>{details.join(' · ')}</Muted>}
          </View>
          {a.route ? <Thumbnail route={a.route} colour={c.muted} /> : null}
        </View>
      </Card>
    </Pressable>
  );
}

// --- the last seven days ------------------------------------------------------------------------------

export function LastSevenDays() {
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const today = useToday();
  const feed = useInfiniteQuery(activitiesQuery(api));
  const health = useHealthWeek(today);
  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);
  const sports = lastSevenDays(items, today, asSport);
  const days = health.data ?? [];
  const steps = average(days, 'steps');
  const resting = average(days, 'resting_hr');
  const hrv = average(days, 'hrv');
  const rows = [
    ...sports.map((s) => ({
      key: s.sport,
      icon: SPORT_ICONS[s.sport],
      tint: c[s.sport],
      label: `${t(`sport.${s.sport}`)} · ${s.count}`,
      value: s.distance > 0 ? format.distance(s.distance) : formatHoursMinutes(s.moving),
    })),
    ...(steps != null
      ? [
          {
            key: 'steps',
            icon: 'footprint' as IconName,
            tint: c.ride,
            label: t('home.steps'),
            value: t('home.average', { value: Math.round(steps).toLocaleString(locale) }),
          },
        ]
      : []),
    ...(resting != null
      ? [
          {
            key: 'hr',
            icon: 'favorite' as IconName,
            tint: c.zone5,
            label: t('home.heartRate'),
            value: t('home.resting', { value: Math.round(resting) }),
          },
        ]
      : []),
    ...(hrv != null
      ? [
          {
            key: 'hrv',
            icon: 'monitor_heart' as IconName,
            tint: c.run,
            label: t('home.hrv'),
            value: t('home.average', { value: `${Math.round(hrv)} ms` }),
          },
        ]
      : []),
  ];
  if (!rows.length) return null;
  return (
    <>
      <Heading>{t('home.last7')}</Heading>
      <Card style={{ paddingVertical: 0, gap: 0 }}>
        {rows.map((r, i) => (
          <Row
            key={r.key}
            icon={r.icon}
            tint={r.tint}
            label={r.label}
            value={r.value}
            last={i === rows.length - 1}
          />
        ))}
      </Card>
    </>
  );
}

// --- metrics ------------------------------------------------------------------------------------------

export function Metrics() {
  const api = useApi();
  const c = useTheme();
  const today = useToday();
  const estimates = useQuery(estimatesQuery(api));
  const fitness = useQuery(fitnessQuery(api, {}));
  const me = useQuery(meQuery(api));
  const health = useHealthWeek(today);
  const vdot = estimates.data?.find((e) => e.kind === 'vdot')?.value;
  const ftp = estimates.data?.find((e) => e.kind === 'ftp')?.value;
  const now = fitness.data?.at(-1);
  const steps = health.data?.find((d) => d.day === today)?.steps?.value ?? 0;
  const weight = me.data?.weight_kg;
  const tiles = [
    vdot ? (
      <Tile key="vo2" icon="directions_run" label={t('home.vo2')}>
        <Gauge value={vdot} min={30} max={70} label={vdot.toFixed(0)} />
        <Muted style={{ textAlign: 'center' }}>{t('home.vo2Note')}</Muted>
      </Tile>
    ) : null,
    ftp ? (
      <Tile key="ftp" icon="directions_bike" label={t('home.ftp')}>
        <Gauge value={ftp / (weight || 75)} min={1.5} max={5} label={`${Math.round(ftp)}`} unit="W" />
        {weight ? (
          <Muted style={{ textAlign: 'center' }}>
            {t('home.perKg', { value: (ftp / weight).toLocaleString(locale, { maximumFractionDigits: 1 }) })}
          </Muted>
        ) : null}
      </Tile>
    ) : null,
    <Tile key="steps" icon="footprint" label={t('home.stepsToday')}>
      <View style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Ring value={steps} max={STEPS_GOAL} size={110} stroke={10} />
        <Text
          style={{
            position: 'absolute',
            color: c.fg,
            fontSize: 22,
            fontWeight: '700',
            fontVariant: ['tabular-nums'],
          }}
        >
          {Math.round(steps).toLocaleString(locale)}
        </Text>
      </View>
    </Tile>,
    now ? (
      <Tile key="load" icon="speed" label={t('home.load')}>
        <Text style={{ color: c.fg, fontSize: 24, fontWeight: '700' }}>{t(formLabel(now.tsb))}</Text>
        <Text style={[ui.statValue, { color: c.fg, fontSize: 28 }]}>
          {Math.round(now.atl)}/{Math.round(now.ctl)}
        </Text>
        <Muted>
          {t('stats.atl')} / {t('stats.ctl')}
        </Muted>
      </Tile>
    ) : null,
  ].filter(Boolean);
  return (
    <>
      <Heading>{t('home.metrics')}</Heading>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{tiles}</View>
    </>
  );
}

// --- pieces -------------------------------------------------------------------------------------------

function Row({
  icon,
  tint,
  label,
  value,
  extra,
  last,
}: {
  icon: IconName;
  tint: string;
  label: string;
  value: string;
  extra?: React.ReactNode;
  last?: boolean;
}) {
  const c = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 14,
        borderBottomWidth: last ? 0 : 1,
        borderColor: c.line,
      }}
    >
      <Icon name={icon} color={tint} size={24} />
      <Text style={{ color: c.fg, fontSize: 16, flex: 1 }}>{label}</Text>
      <Text style={{ color: c.fg, fontSize: 16, fontVariant: ['tabular-nums'] }}>{value}</Text>
      {extra}
    </View>
  );
}

function Tile({ icon, label, children }: { icon: IconName; label: string; children: React.ReactNode }) {
  const c = useTheme();
  return (
    <Card style={{ flexBasis: '47%', flexGrow: 1, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={icon} color={c.fg} size={22} />
        <Text style={{ color: c.fg, fontSize: 14, fontWeight: '600', flex: 1 }}>{label}</Text>
      </View>
      {children}
    </Card>
  );
}

/** An arc from `from` to `to` degrees (0 is up, clockwise) as SVG path data, for Skia. */
function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const point = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return `${(cx + r * Math.cos(rad)).toFixed(2)} ${(cy + r * Math.sin(rad)).toFixed(2)}`;
  };
  const large = to - from > 180 ? 1 : 0;
  return `M ${point(from)} A ${r} ${r} 0 ${large} 1 ${point(to)}`;
}

/** Progress as a ring (steps against the day's goal). */
function Ring({
  value,
  max,
  size,
  stroke = 4,
}: {
  value: number;
  max: number;
  size: number;
  stroke?: number;
}) {
  const c = useTheme();
  const share = Math.max(0, Math.min(1, value / max));
  const r = (size - stroke) / 2;
  const track = Skia.Path.MakeFromSVGString(arc(size / 2, size / 2, r, 0, 359.99));
  const done =
    share > 0
      ? Skia.Path.MakeFromSVGString(arc(size / 2, size / 2, r, 0, Math.max(1, share * 359.99)))
      : null;
  return (
    <Canvas style={{ width: size, height: size }}>
      {track && <Path path={track} style="stroke" strokeWidth={stroke} color={c.line} />}
      {done && <Path path={done} style="stroke" strokeWidth={stroke} strokeCap="round" color={c.ride} />}
    </Canvas>
  );
}

const GAUGE = ['#e03131', '#e8590c', '#2f9e44', '#1c7ed6', '#7950f2'];

/** A 270° gauge in five coloured bands, with a dot at the value and the figure in the middle. */
function Gauge({
  value,
  min,
  max,
  label,
  unit,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  unit?: string;
}) {
  const c = useTheme();
  const size = 120;
  const r = 48;
  const start = -135;
  const sweep = 270;
  const gap = 4;
  const bands = GAUGE.map((colour, i) => {
    const from = start + (sweep / GAUGE.length) * i + (i ? gap / 2 : 0);
    const to = start + (sweep / GAUGE.length) * (i + 1) - (i < GAUGE.length - 1 ? gap / 2 : 0);
    return { colour, path: Skia.Path.MakeFromSVGString(arc(size / 2, size / 2, r, from, to)) };
  });
  const share = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const angle = ((start + sweep * share - 90) * Math.PI) / 180;
  const dot = Skia.Path.MakeFromSVGString(
    `M ${size / 2 + r * Math.cos(angle) + 8} ${size / 2 + r * Math.sin(angle)} a 8 8 0 1 0 -16 0 a 8 8 0 1 0 16 0`,
  );
  const dotColour = GAUGE[Math.min(GAUGE.length - 1, Math.floor(share * GAUGE.length))] ?? c.fg;
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Canvas style={{ width: size, height: size }}>
        {bands.map((b) =>
          b.path ? (
            <Path
              key={b.colour}
              path={b.path}
              style="stroke"
              strokeWidth={8}
              strokeCap="round"
              color={b.colour}
            />
          ) : null,
        )}
        {dot && <Path path={dot} color={dotColour} />}
      </Canvas>
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <Text style={{ color: c.fg, fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
          {label}
        </Text>
        {unit ? <Muted>{unit}</Muted> : null}
      </View>
    </View>
  );
}
