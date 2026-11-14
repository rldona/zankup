/**
 * Goals on Progress (as Strava's): the card shows up to three goals as rings; app/objectives.tsx lists
 * them all with their numbers and charts. The ring, the goal's words and its chart are shared.
 */
import { Canvas, Circle, Group, Line, Path, vec } from '@shopify/react-native-skia';
import { goalsQuery, SPORT_ICONS, type GoalOut } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useApi } from '../auth';
import { useCanvasReady } from '../charts';
import { Icon, type IconName } from '../Icon';
import { locale, t } from '../i18n';
import { asSport } from '../prefs';
import { CardSkeleton } from '../Skeleton';
import { useTheme } from '../theme';
import { accent, Card, Muted } from '../ui';
import { fraction, runningTotal, type GoalMetric, type GoalPeriod } from './goals';
import { useVolumeFormat } from './VolumeCard';

export const goalIcon = (sport: string | null): IconName =>
  sport ? SPORT_ICONS[asSport(sport)] : 'monitoring';
export const goalSport = (sport: string | null) =>
  sport ? t(`sport.${asSport(sport)}`) : t('progress.allSports');

/** "Semanal: Objetivo de distancia" and, under it, the sport (and the count, for activities). */
export function goalWords(g: GoalOut) {
  const title = t('progress.goalTitle', {
    period: t(`progress.goalPeriod.${g.period as GoalPeriod}`),
    kind: t(`progress.goalKind.${g.metric as GoalMetric}`),
  });
  const note =
    g.metric === 'count'
      ? t('progress.goalCountNote', { sport: goalSport(g.sport), count: Math.round(g.target) })
      : goalSport(g.sport);
  return { title, note };
}

/** A goal's ring: how far along it is, with its sport in the middle. */
export function GoalRing({ goal, size = 64 }: { goal: GoalOut; size?: number }) {
  const c = useTheme();
  const ready = useCanvasReady(size);
  const stroke = size * 0.09;
  const r = size / 2 - stroke / 2 - 1;
  // A circle from the top, clockwise, so the ring fills from twelve o'clock.
  const m = size / 2;
  const circle = `M${m} ${m - r}A${r} ${r} 0 1 1 ${m} ${m + r}A${r} ${r} 0 1 1 ${m} ${m - r}`;
  const done = fraction(goal);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Canvas style={{ position: 'absolute', width: size, height: size, opacity: ready ? 1 : 0 }}>
        {ready && (
          <>
            <Path path={circle} style="stroke" strokeWidth={stroke} color={c.line} />
            {done > 0 && (
              <Path
                path={circle}
                style="stroke"
                strokeWidth={stroke}
                strokeCap="round"
                start={0}
                end={done}
                color={String(c.accent)}
              />
            )}
          </>
        )}
      </Canvas>
      <Icon name={goalIcon(goal.sport)} color={c.fg} size={size * 0.4} />
    </View>
  );
}

export function GoalsCard() {
  const api = useApi();
  const c = useTheme();
  const format = useVolumeFormat();
  const goals = useQuery(goalsQuery(api));
  if (goals.isPending) return <CardSkeleton lines={4} />;
  const list = goals.data ?? [];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('progress.goals')}
      onPress={() => router.push('/objectives')}
    >
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name="flag" color={accent(c)} size={26} />
          <Text style={{ flex: 1, color: c.fg, fontSize: 16, fontWeight: '700' }}>{t('progress.goals')}</Text>
          <Icon name="chevron_right" color={c.muted} size={22} />
        </View>
        {!list.length ? (
          <Muted style={{ marginTop: 8 }}>{t('progress.noGoals')}</Muted>
        ) : (
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: 12 }}>
            {list.slice(0, 3).map((g) => (
              <View key={g.id} style={{ alignItems: 'center', gap: 8, flex: 1 }}>
                <GoalRing goal={g} size={56} />
                <Text style={{ color: c.fg, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                  {format.value(g.metric as GoalMetric, g.current, 1)}
                </Text>
                <Text style={{ color: c.fg, fontSize: 13, textAlign: 'center' }}>
                  {t(`progress.goalPer.${g.period as GoalPeriod}`, {
                    value: format.value(g.metric as GoalMetric, g.target, 0),
                  })}
                </Text>
              </View>
            ))}
          </View>
        )}
      </Card>
    </Pressable>
  );
}

/**
 * A goal over time. Weeks or months: each one's value (filled) against the goal (grey) on its own
 * line. The year: the running total month by month against the goal's diagonal.
 */
export function GoalChart({
  period,
  target,
  starts,
  values,
  height = 150,
}: {
  period: GoalPeriod;
  target: number;
  /** Each bucket's first day. */
  starts: string[];
  values: number[];
  height?: number;
}) {
  const c = useTheme();
  const [width, setWidth] = useState(0);
  const ready = useCanvasReady(width);
  const top = 12;
  const base = height - 30;
  const year = period === 'year';
  const shown = year ? [0, ...runningTotal(values)] : values;
  const slots = year ? 13 : Math.max(1, shown.length);
  const max = Math.max(target, ...shown, 1);
  // 16 px in from each side: the last point's 14 px halo stays inside the chart.
  const x = (i: number) => 16 + (i / Math.max(1, slots - 1)) * (width - 32);
  const y = (v: number) => base - (Math.min(v, max) / max) * (base - top);
  const colour = String(c.accent);
  const last = shown.length - 1;
  const month = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { month: 'short' }).replace('.', '');
  const labels = year
    ? [0, 3, 6, 9].map((m) => ({
        i: m,
        text: month(`${starts[0]?.slice(0, 4) ?? '2026'}-${String(m + 1).padStart(2, '0')}-15`),
      }))
    : starts.flatMap((s, i) =>
        i === 0 || s.slice(5, 7) !== starts[i - 1].slice(5, 7) ? [{ i, text: month(s) }] : [],
      );
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height, opacity: ready ? 1 : 0 }}>
      {width > 0 && (
        <>
          <Canvas style={{ width, height }}>
            {ready && (
              <>
                <Line p1={vec(0, top)} p2={vec(width, top)} color={c.line} strokeWidth={1} />
                <Line p1={vec(0, base)} p2={vec(width, base)} color={c.line} strokeWidth={1} />
                {Array.from({ length: slots }, (_, i) => (
                  <Line key={i} p1={vec(x(i), top)} p2={vec(x(i), base)} color={c.line} strokeWidth={1} />
                ))}
                {year ? (
                  <>
                    <Line p1={vec(x(0), y(0))} p2={vec(x(12), y(target))} color={c.muted} strokeWidth={2} />
                    <Path
                      path={shown.map((v, i) => `${i ? 'L' : 'M'}${x(i)} ${y(v)}`).join('')}
                      style="stroke"
                      strokeWidth={3}
                      strokeJoin="round"
                      color={colour}
                    />
                  </>
                ) : (
                  shown.map((v, i) => (
                    <Group key={i}>
                      <Circle cx={x(i)} cy={y(target)} r={6} color={c.muted} />
                      <Circle cx={x(i)} cy={y(v)} r={6} color={colour} />
                    </Group>
                  ))
                )}
                {last >= 0 && (
                  <>
                    <Circle cx={x(last)} cy={y(shown[last])} r={14} color={colour} opacity={0.3} />
                    <Circle cx={x(last)} cy={y(shown[last])} r={7} color={colour} />
                  </>
                )}
              </>
            )}
          </Canvas>
          {labels.map(({ i, text }) => (
            <Text
              key={i}
              style={{ position: 'absolute', top: base + 8, left: x(i) + 6, color: c.fg, fontSize: 13 }}
            >
              {text}
            </Text>
          ))}
        </>
      )}
    </View>
  );
}
