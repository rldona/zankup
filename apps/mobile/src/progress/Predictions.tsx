/**
 * Race predictions on Progress (as Strava's): the card shows the 5 km prediction and its last month;
 * app/predictions.tsx shows the four races today or one over months. The distance badge, the change
 * badge and the time line (faster is higher) are shared by both.
 */
import { Canvas, Circle, Group, Line, Path, vec } from '@shopify/react-native-skia';
import { estimatesQuery } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useApi } from '../auth';
import { useCanvasReady } from '../charts';
import { Icon } from '../Icon';
import { t } from '../i18n';
import { CardSkeleton } from '../Skeleton';
import { useTheme } from '../theme';
import { accent, Card, Muted } from '../ui';
import { isoDay } from './fitness';
import { changeText, RACES, raceTime, series, valueOn, type Point, type RaceKind } from './raceTimes';
import { addDays } from './weeks';

/** Each race's history (day and predicted seconds), oldest first. */
export function usePredictions() {
  const api = useApi();
  const estimates = useQuery(estimatesQuery(api));
  const byKind = new Map<string, Point[]>(
    (estimates.data ?? []).map((e) => [e.kind, e.history.map((h) => ({ day: h.day, value: h.value }))]),
  );
  return { byKind, isPending: estimates.isPending };
}

/** A race's distance on a scalloped badge in the accent, as Strava's: 5 · 10 · 21,1 · 42,2 KM. */
export function RaceBadge({ race, size = 64 }: { race: RaceKind; size?: number }) {
  const c = useTheme();
  const ready = useCanvasReady(size);
  const r = size / 2;
  const points = 24;
  const path =
    Array.from({ length: points }, (_, i) => {
      const a = (i / points) * Math.PI * 2 - Math.PI / 2;
      const radius = i % 2 ? r * 0.82 : r * 0.94;
      return `${i ? 'L' : 'M'}${r + radius * Math.cos(a)} ${r + radius * Math.sin(a)}`;
    }).join('') + 'Z';
  const badge = RACES.find((x) => x.kind === race)?.badge ?? '';
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Canvas style={{ position: 'absolute', width: size, height: size, opacity: ready ? 1 : 0 }}>
        {ready && (
          <Path path={path} style="stroke" strokeWidth={2.5} strokeJoin="round" color={String(c.accent)} />
        )}
      </Canvas>
      <Text
        style={{ color: accent(c), fontSize: size * (badge.length > 2 ? 0.26 : 0.32), fontWeight: '800' }}
      >
        {badge}
      </Text>
      <Text style={{ color: accent(c), fontSize: size * 0.14, fontWeight: '700', marginTop: -2 }}>KM</Text>
    </View>
  );
}

/** How much a prediction changed: ▼ faster (in green), ▲ slower. */
export function ChangeBadge({ seconds }: { seconds: number }) {
  const c = useTheme();
  const faster = seconds < 0;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        backgroundColor: c.surface2,
      }}
    >
      <Text style={{ color: faster ? c.formPositive : c.muted, fontSize: 11 }}>{faster ? '▼' : '▲'}</Text>
      <Text style={{ color: c.fg, fontSize: 14, fontVariant: ['tabular-nums'] }}>{changeText(seconds)}</Text>
    </View>
  );
}

export function PredictionsCard() {
  const c = useTheme();
  const { byKind, isPending } = usePredictions();
  if (isPending) return <CardSkeleton lines={3} />;
  const today = isoDay(new Date());
  const history = byKind.get('race_5k') ?? [];
  const line = series(history, addDays(today, -30), today);
  const now = valueOn(history, today);
  const before = line[0]?.value;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('progress.predictions')}: 5 km ${now != null ? raceTime(now) : '–'}`}
      onPress={() => router.push('/predictions')}
    >
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name="timer" color={accent(c)} size={26} />
          <Text style={{ flex: 1, color: c.fg, fontSize: 16, fontWeight: '700' }}>
            {t('progress.predictions')}
          </Text>
          <Muted style={{ fontSize: 14 }}>{t('progress.lastMonth')}</Muted>
          <Icon name="chevron_right" color={c.muted} size={22} />
        </View>
        {now == null || before == null ? (
          <Muted style={{ marginTop: 12 }}>{t('progress.noPredictions')}</Muted>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 8 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: c.fg, fontSize: 14 }}>{t('progress.race.race_5k')}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ color: c.fg, fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                  {raceTime(now)}
                </Text>
                <ChangeBadge seconds={now - before} />
              </View>
            </View>
            <TimeSparkline values={line.map((p) => p.value)} />
          </View>
        )}
      </Card>
    </Pressable>
  );
}

/** The card's line: faster is higher, the first time written before it, today's point filled. */
function TimeSparkline({
  values,
  width = 150,
  height = 70,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  const c = useTheme();
  const ready = useCanvasReady(width);
  const colour = String(c.accent);
  const left = 56;
  const pad = 12;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // Faster is higher; a flat line sits in the middle.
  const y = (v: number) => (hi > lo ? pad + ((v - lo) / (hi - lo)) * (height - 2 * pad) : height / 2);
  const step = values.length > 1 ? (width - left - pad) / (values.length - 1) : 0;
  const pts = values.map((v, i) => [left + i * step, y(v)] as const);
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (!first || !last) return null;
  return (
    <View style={{ width, height, opacity: ready ? 1 : 0 }}>
      <Canvas style={{ width, height }}>
        {ready && (
          <>
            <Path
              path={pts.map(([x, py], i) => `${i ? 'L' : 'M'}${x} ${py}`).join('')}
              style="stroke"
              strokeWidth={3}
              color={colour}
            />
            <Circle cx={first[0]} cy={first[1]} r={5} color={c.surface} />
            <Circle cx={first[0]} cy={first[1]} r={5} style="stroke" strokeWidth={2.5} color={colour} />
            <Circle cx={last[0]} cy={last[1]} r={12} color={colour} opacity={0.25} />
            <Circle cx={last[0]} cy={last[1]} r={6} color={colour} />
          </>
        )}
      </Canvas>
      <Text
        style={{
          position: 'absolute',
          left: 0,
          width: left - 8,
          textAlign: 'right',
          top: first[1] - 10,
          color: c.muted,
          fontSize: 13,
          fontVariant: ['tabular-nums'],
        }}
      >
        {raceTime(values[0])}
      </Text>
    </View>
  );
}

/**
 * A prediction over a range: faster is higher, a ring where it changed, today filled, times on the
 * right and dates under it.
 */
export function PredictionChart({
  points,
  from,
  to,
  ticks,
  labels,
  height = 300,
}: {
  points: Point[];
  /** The range's first and last day: points and labels are placed by their date between them. */
  from: string;
  to: string;
  ticks: number[];
  labels: { day: string; text: string }[];
  height?: number;
}) {
  const c = useTheme();
  const [width, setWidth] = useState(0);
  const ready = useCanvasReady(width);
  const axis = 84;
  const plot = Math.max(0, width - axis);
  const top = 10;
  const base = height - 30;
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const y = (v: number) => top + ((v - lo) / (hi - lo || 1)) * (base - top);
  const ms = (iso: string) => new Date(`${iso}T12:00:00`).getTime();
  const x = (day: string) => 8 + ((ms(day) - ms(from)) / (ms(to) - ms(from) || 1)) * (plot - 16);
  const colour = String(c.accent);
  const last = points.length - 1;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height, opacity: ready ? 1 : 0 }}>
      {width > 0 && (
        <>
          <Canvas style={{ width, height }}>
            {ready && (
              <>
                {ticks.map((v) => (
                  <Line key={v} p1={vec(0, y(v))} p2={vec(plot, y(v))} color={c.line} strokeWidth={1} />
                ))}
                <Path
                  path={points.map((p, i) => `${i ? 'L' : 'M'}${x(p.day)} ${y(p.value)}`).join('')}
                  style="stroke"
                  strokeWidth={3}
                  strokeJoin="round"
                  color={colour}
                />
                {points.map((p, i) =>
                  i === last ? null : (
                    <Group key={i}>
                      <Circle cx={x(p.day)} cy={y(p.value)} r={5} color={c.bg} />
                      <Circle
                        cx={x(p.day)}
                        cy={y(p.value)}
                        r={5}
                        style="stroke"
                        strokeWidth={2.5}
                        color={colour}
                      />
                    </Group>
                  ),
                )}
                {last >= 0 && (
                  <>
                    <Circle
                      cx={x(points[last].day)}
                      cy={y(points[last].value)}
                      r={14}
                      color={colour}
                      opacity={0.25}
                    />
                    <Circle cx={x(points[last].day)} cy={y(points[last].value)} r={7} color={colour} />
                  </>
                )}
              </>
            )}
          </Canvas>
          {ticks.map((v) => (
            <Text
              key={v}
              style={{
                position: 'absolute',
                right: 0,
                top: y(v) - 10,
                color: c.fg,
                fontSize: 13,
                fontVariant: ['tabular-nums'],
              }}
            >
              {raceTime(v)}
            </Text>
          ))}
          {labels.map(({ day, text }) => (
            <Text
              key={day}
              numberOfLines={1}
              style={{
                position: 'absolute',
                top: base + 8,
                left: Math.max(0, x(day) - 30),
                width: 60,
                textAlign: 'center',
                color: c.fg,
                fontSize: 12,
              }}
            >
              {text}
            </Text>
          ))}
        </>
      )}
    </View>
  );
}
