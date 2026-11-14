/**
 * Series on Progress (as Strava's Streaks): weeks in a row with at least one activity, in a flame. A tap
 * opens the month: each day with its sport (a tap opens the activity) and, beside each week, whether it
 * kept the streak, on a band that runs through the streak to this week's flame.
 */
import { calendarQuery, SPORT_ICONS, streakQuery, type CalendarDay } from '@zankup/core';
import { Canvas, Path } from '@shopify/react-native-skia';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useApi } from '../auth';
import { useCanvasReady } from '../charts';
import { Icon } from '../Icon';
import { locale, t } from '../i18n';
import { asSport } from '../prefs';
import { CardSkeleton } from '../Skeleton';
import { monthGrid } from '../stats/dates';
import { useTheme } from '../theme';
import { accent, Card, InfoButton, Muted, onAccent } from '../ui';
import { isoDay } from './fitness';
import { addDays, weekDays, weekMark, type WeekMark } from './weeks';
import { Panel } from './Panel';

/** The card; its month opens in a panel the screen holds (`onOpen`), outside the row of cards. */
export function SeriesCard({ onOpen }: { onOpen: () => void }) {
  const api = useApi();
  const c = useTheme();
  const streak = useQuery(streakQuery(api));
  if (streak.isPending) return <CardSkeleton lines={4} />;
  const weeks = streak.data?.weeks ?? 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('progress.series')}: ${t('progress.streakWeeks', { count: weeks })}`}
      onPress={onOpen}
      style={{ flex: 1 }}
    >
      <Card style={{ flex: 1, marginBottom: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ flex: 1, color: c.fg, fontSize: 16, fontWeight: '700' }}>
            {t('progress.series')}
          </Text>
          <Icon name="chevron_right" color={c.muted} size={22} />
        </View>
        <View style={{ alignItems: 'center', marginTop: 10 }}>
          <Flame weeks={weeks} size={88} />
          <Text style={{ color: accent(c), fontSize: 18, fontWeight: '800' }}>
            {t('progress.weeksWord', { count: weeks })}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

/** Series' month in its panel. */
export function SeriesPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Panel open={open} onClose={onClose}>
      <SeriesMonth onClose={onClose} />
    </Panel>
  );
}

/**
 * A solid flame (two tips, the left one taller, as Strava's) in a 100-unit box, so the weeks can sit on
 * it: Material's filled flame has a hollow inside.
 */
const FLAME =
  'M50 99C24 99 9 82 9 61C9 41 22 30 30 9C35 23 42 31 47 35C50 25 55 19 58 10C74 27 91 42 91 63C91 84 75 99 50 99Z';

/** The flame with the weeks on it, low down where it is widest. */
function Flame({ weeks, size }: { weeks: number; size: number }) {
  const c = useTheme();
  const ready = useCanvasReady(size);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Canvas style={{ width: size, height: size, opacity: ready ? 1 : 0 }}>
        {ready && <Path path={FLAME} color={String(c.accent)} transform={[{ scale: size / 100 }]} />}
      </Canvas>
      <Text
        style={{
          position: 'absolute',
          top: size * 0.44,
          color: c.accentFg,
          fontSize: size * (weeks > 99 ? 0.26 : 0.32),
          fontWeight: '800',
          fontVariant: ['tabular-nums'],
        }}
      >
        {weeks}
      </Text>
    </View>
  );
}

const ROW = 50;

function SeriesMonth({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const c = useTheme();
  const now = new Date();
  const today = isoDay(now);
  const [month, setMonth] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [from, to] = monthGrid(month.year, month.month);
  const calendar = useQuery(calendarQuery(api, { from, to }));
  const streak = useQuery(streakQuery(api)).data;
  const days = new Map((calendar.data as CalendarDay[] | undefined)?.map((d) => [d.day, d]) ?? []);
  const mondays: string[] = [];
  for (let d = from; d < to; d = addDays(d, 7)) mondays.push(d);
  const marks = mondays.map((m) =>
    weekMark(
      m,
      today,
      weekDays(m).some((d) => days.get(d)?.activities.length),
      {
        since: streak?.since ?? null,
        weeks: streak?.weeks ?? 0,
      },
    ),
  );
  const title = new Date(month.year, month.month - 1, 15).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  });
  const isThisMonth = month.year === now.getFullYear() && month.month === now.getMonth() + 1;
  const shift = (by: number) => {
    const d = new Date(month.year, month.month - 1 + by, 15);
    setMonth({ year: d.getFullYear(), month: d.getMonth() + 1 });
  };
  const letters = weekDays(mondays[0] ?? today).map((d) =>
    new Date(`${d}T12:00:00`).toLocaleDateString(locale, { weekday: 'narrow' }).toUpperCase(),
  );
  const band = (m: WeekMark) => m === 'streak' || m === 'current';

  return (
    <View style={{ paddingHorizontal: 16, gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ flex: 1, color: c.fg, fontSize: 18, fontWeight: '800' }}>{title}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('progress.prevMonth')}
          hitSlop={10}
          onPress={() => shift(-1)}
        >
          <Icon name="chevron_left" color={c.fg} size={30} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('progress.nextMonth')}
          hitSlop={10}
          disabled={isThisMonth}
          onPress={() => shift(1)}
        >
          <Icon name="chevron_right" color={isThisMonth ? c.line : c.fg} size={30} />
        </Pressable>
        <InfoButton text={t('progress.streakInfo')} />
      </View>
      <View style={{ flexDirection: 'row', gap: 40 }}>
        <View>
          <Muted style={{ color: c.fg, fontSize: 13 }}>{t('progress.yourStreak')}</Muted>
          <Text style={{ color: c.fg, fontSize: 18, fontWeight: '800' }}>
            {t('progress.streakWeeks', { count: streak?.weeks ?? 0 })}
          </Text>
        </View>
        <View>
          <Muted style={{ color: c.fg, fontSize: 13 }}>{t('progress.streakActivities')}</Muted>
          <Text style={{ color: c.fg, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
            {streak?.activities ?? 0}
          </Text>
        </View>
      </View>
      {!streak?.weeks && <Muted>{t('progress.noStreak')}</Muted>}

      <View>
        <View style={{ flexDirection: 'row', marginBottom: 6 }}>
          {letters.map((l, i) => (
            <Text key={i} style={{ flex: 1, textAlign: 'center', color: c.fg, fontSize: 13 }}>
              {l}
            </Text>
          ))}
          <View style={{ width: 52 }} />
        </View>
        {mondays.map((monday, w) => (
          <View key={monday} style={{ flexDirection: 'row', height: ROW, alignItems: 'center' }}>
            {weekDays(monday).map((day) => (
              <DayCell
                key={day}
                day={day}
                today={today}
                inMonth={Number(day.slice(5, 7)) === month.month}
                activities={days.get(day)?.activities ?? []}
                onOpen={(id) => {
                  onClose();
                  router.push(`/activity/${id}`);
                }}
              />
            ))}
            <View style={{ width: 52, height: ROW, alignItems: 'center', justifyContent: 'center' }}>
              {band(marks[w]) && (
                <View
                  style={{
                    position: 'absolute',
                    left: 8,
                    right: 8,
                    top: band(marks[w - 1] ?? 'missed') ? 0 : 4,
                    bottom: band(marks[w + 1] ?? 'missed') ? 0 : 4,
                    backgroundColor: accent(c),
                    opacity: 0.25,
                    borderTopLeftRadius: band(marks[w - 1] ?? 'missed') ? 0 : 18,
                    borderTopRightRadius: band(marks[w - 1] ?? 'missed') ? 0 : 18,
                    borderBottomLeftRadius: band(marks[w + 1] ?? 'missed') ? 0 : 18,
                    borderBottomRightRadius: band(marks[w + 1] ?? 'missed') ? 0 : 18,
                  }}
                />
              )}
              <WeekBadge mark={marks[w]} weeks={streak?.weeks ?? 0} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function WeekBadge({ mark, weeks }: { mark: WeekMark; weeks: number }) {
  const c = useTheme();
  if (mark === 'current') return <Flame weeks={weeks} size={44} />;
  if (mark === 'streak' || mark === 'done')
    return (
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          backgroundColor: accent(c),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="check" color={onAccent(c)} size={18} />
      </View>
    );
  return <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: c.line }} />;
}

function DayCell({
  day,
  today,
  inMonth,
  activities,
  onOpen,
}: {
  day: string;
  today: string;
  inMonth: boolean;
  activities: CalendarDay['activities'];
  onOpen: (id: number) => void;
}) {
  const c = useTheme();
  const n = Number(day.slice(8));
  const size = 38;
  const first = activities[0];
  let cell;
  if (!inMonth) cell = <Text style={{ color: c.muted, fontSize: 14 }}>{n}</Text>;
  else if (first)
    cell = (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={first.name ?? first.sport}
        onPress={() => onOpen(first.id)}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: c.fg,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: day === today ? 2 : 0,
          borderColor: accent(c),
        }}
      >
        <Icon name={SPORT_ICONS[asSport(first.sport)]} color={c.bg} size={22} />
        {activities.length > 1 && (
          <View
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              width: 12,
              height: 12,
              borderRadius: 6,
              backgroundColor: c.fg,
              borderWidth: 2,
              borderColor: c.surface,
            }}
          />
        )}
      </Pressable>
    );
  else
    cell = (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: day < today ? c.surface2 : 'transparent',
          borderWidth: day >= today ? (day === today ? 2 : 1.5) : 0,
          borderColor: day === today ? c.fg : c.line,
        }}
      >
        <Text style={{ color: c.fg, fontSize: 14, fontVariant: ['tabular-nums'] }}>{n}</Text>
      </View>
    );
  return <View style={{ flex: 1, alignItems: 'center' }}>{cell}</View>;
}
