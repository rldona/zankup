/**
 * Relative effort on Progress (as Strava's): this week's score, whether it is in the range of the three
 * weeks before, last week's score, and both weeks built up day by day over the range. The weeks behind
 * it (`useEffortWeeks`) and the status colours are shared with app/effort.tsx.
 */
import { Canvas, Circle, Line, Path, Rect, vec } from '@shopify/react-native-skia';
import { volumeQuery } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useApi } from '../auth';
import { useCanvasReady } from '../charts';
import { Icon } from '../Icon';
import { locale, t } from '../i18n';
import { CardSkeleton } from '../Skeleton';
import { useTheme, type Palette } from '../theme';
import { accent, Card, Muted, onAccent } from '../ui';
import { cumulative, effortStatus, weeklyRange, type EffortRange, type EffortStatus } from './effort';
import { isoDay } from './fitness';
import { addDays, weekAt, weekDays } from './weeks';

export type EffortWeek = { monday: string; score: number; range: EffortRange | null; status: EffortStatus };

type Bucket = { start: string; totals: { load?: number } };

/** The last `count` weeks (oldest first), each judged against the three before it. */
export function useEffortWeeks(count: number) {
  const api = useApi();
  const today = isoDay(new Date());
  const volume = useQuery(
    volumeQuery(api, { from: weekAt(count + 2, today), to: addDays(today, 1) }, 'week'),
  );
  const scores = ((volume.data ?? []) as Bucket[]).map((b) => ({
    monday: b.start,
    score: Math.round(b.totals.load ?? 0),
  }));
  const weeks: EffortWeek[] = scores.slice(3).map((w, i) => {
    const range = weeklyRange(scores.slice(i, i + 3).map((s) => s.score));
    return { ...w, range, status: effortStatus(w.score, range) };
  });
  return { weeks, isPending: volume.isPending };
}

/** A status's colour from the theme: blue under the range, the accent in it, orange and red over. */
export function statusColour(c: Palette, status: EffortStatus) {
  if (status === 'in') return accent(c);
  return status === 'below' ? c.fitness : status === 'above' ? c.zone4 : c.zone5;
}

/** The same colour for Skia, which takes no dynamic (Material You) colour. */
export const statusPaint = (c: Palette, status: EffortStatus) =>
  status === 'in' ? String(c.accent) : String(statusColour(c, status));

/** Text on a status colour. */
export const onStatus = (c: Palette, status: EffortStatus) => (status === 'in' ? onAccent(c) : '#fff');

/** Each day's effort of this week and the last (Monday first). */
function useDays() {
  const api = useApi();
  const today = isoDay(new Date());
  const from = weekAt(1, today);
  const volume = useQuery(volumeQuery(api, { from, to: addDays(weekAt(0, today), 7) }, 'day'));
  const byDay = new Map(((volume.data ?? []) as Bucket[]).map((b) => [b.start, b.totals.load ?? 0]));
  const week = (monday: string) => weekDays(monday).map((d) => byDay.get(d) ?? 0);
  return { thisWeek: week(weekAt(0, today)), lastWeek: week(from), isPending: volume.isPending };
}

export function EffortCard() {
  const c = useTheme();
  const { weeks, isPending } = useEffortWeeks(2);
  const days = useDays();
  if (isPending || days.isPending) return <CardSkeleton lines={4} />;
  const now = weeks.at(-1);
  const before = weeks.at(-2);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('progress.effort')}: ${now?.score ?? 0}`}
      onPress={() => router.push('/effort')}
    >
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name="speed" color={accent(c)} size={26} />
          <Text style={{ flex: 1, color: c.fg, fontSize: 16, fontWeight: '700' }}>
            {t('progress.effort')}
          </Text>
          <Muted style={{ fontSize: 14 }}>{t('progress.thisWeek')}</Muted>
          <Icon name="chevron_right" color={c.muted} size={22} />
        </View>
        {!now ? (
          <Muted style={{ marginTop: 12 }}>{t('progress.noEffort')}</Muted>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 10, gap: 8 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: c.fg, fontSize: 14 }}>{t('progress.score')}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Text style={{ color: c.fg, fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                  {now.score}
                </Text>
                {now.range && (
                  <View
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: 6,
                      backgroundColor: statusColour(c, now.status),
                    }}
                  >
                    <Text numberOfLines={1} style={{ color: onStatus(c, now.status), fontSize: 13 }}>
                      {t(`progress.effortStatus.${now.status}`)}
                    </Text>
                  </View>
                )}
              </View>
              {before && (
                <Text style={{ color: c.fg, fontSize: 14 }}>
                  {t('progress.lastWeekScore', { score: before.score })}
                </Text>
              )}
            </View>
            <WeekSoFar
              thisWeek={days.thisWeek}
              lastWeek={days.lastWeek}
              range={now.range}
              status={now.status}
            />
          </View>
        )}
      </Card>
    </Pressable>
  );
}

/** Both weeks added up day by day over the range band, today marked, the days written under. */
function WeekSoFar({
  thisWeek,
  lastWeek,
  range,
  status,
  width = 132,
  height = 104,
}: {
  thisWeek: number[];
  lastWeek: number[];
  range: EffortRange | null;
  status: EffortStatus;
  width?: number;
  height?: number;
}) {
  const c = useTheme();
  const ready = useCanvasReady(width);
  const today = (new Date().getDay() + 6) % 7;
  const now = cumulative(thisWeek, today);
  const before = cumulative(lastWeek);
  const left = 0;
  const plot = width - 8;
  const top = 8;
  const base = height - 24;
  const max = Math.max(1, range?.hi ?? 0, before.at(-1) ?? 0, now.at(-1) ?? 0) * 1.1;
  const x = (i: number) => left + 4 + (i / 6) * (plot - 8);
  const y = (v: number) => base - (v / max) * (base - top);
  const line = (values: number[]) => values.map((v, i) => `${i ? 'L' : 'M'}${x(i)} ${y(v)}`).join('');
  const colour = statusPaint(c, status);
  const end = now.length - 1;
  const letters = weekDays(weekAt(0, isoDay(new Date()))).map((d) =>
    new Date(`${d}T12:00:00`).toLocaleDateString(locale, { weekday: 'narrow' }).toUpperCase(),
  );
  return (
    <View style={{ width: width + 52, flexDirection: 'row', alignItems: 'flex-start' }}>
      <View style={{ width: 52, height: base, justifyContent: 'flex-start' }}>
        {range && (
          <Muted
            style={{ position: 'absolute', right: 6, top: (y(range.hi) + y(range.lo)) / 2 - 9, fontSize: 12 }}
          >
            {range.lo}-{range.hi}
          </Muted>
        )}
      </View>
      <View style={{ width, height, opacity: ready ? 1 : 0 }}>
        <Canvas style={{ width, height }}>
          {ready && (
            <>
              <Line p1={vec(left, top)} p2={vec(plot, top)} color={c.line} strokeWidth={1} />
              <Line p1={vec(left, base)} p2={vec(plot, base)} color={c.line} strokeWidth={1} />
              {range && (
                <Rect
                  x={left}
                  y={y(range.hi)}
                  width={plot}
                  height={y(range.lo) - y(range.hi)}
                  color={colour}
                  opacity={0.18}
                />
              )}
              <Path path={line(before)} style="stroke" strokeWidth={2.5} color={c.muted} strokeJoin="round" />
              {now.length > 0 && (
                <>
                  <Path path={line(now)} style="stroke" strokeWidth={3} color={colour} strokeJoin="round" />
                  <Circle cx={x(0)} cy={y(now[0])} r={5} color={c.surface} />
                  <Circle cx={x(0)} cy={y(now[0])} r={5} style="stroke" strokeWidth={2.5} color={colour} />
                  <Circle cx={x(end)} cy={y(now[end])} r={12} color={colour} opacity={0.25} />
                  <Circle cx={x(end)} cy={y(now[end])} r={6} color={colour} />
                </>
              )}
            </>
          )}
        </Canvas>
        {letters.map((l, i) => (
          <Text
            key={i}
            style={{
              position: 'absolute',
              top: base + 6,
              left: x(i) - 8,
              width: 16,
              textAlign: 'center',
              color: i === today ? c.fg : c.muted,
              fontSize: 12,
            }}
          >
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}
