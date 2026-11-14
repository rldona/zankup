/**
 * Training log on Progress (as Strava's): this week and the last as a row of dots each (bigger, longer;
 * coloured by sport, grey when a day has several), with their time. The screen behind it is in
 * app/training-log.tsx; the week rows of both are here.
 */
import { calendarQuery, formatHoursMinutes, type CalendarDay } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useApi } from '../auth';
import { Icon } from '../Icon';
import { locale, t } from '../i18n';
import { asSport, useFormat, useUnits } from '../prefs';
import { CardSkeleton } from '../Skeleton';
import { sportColour } from '../stats/Sections';
import { useTheme } from '../theme';
import { accent, Card, Muted } from '../ui';
import { isoDay } from './fitness';
import {
  addDays,
  bubbleLabel,
  bubbleSize,
  valueOf,
  weekAt,
  weekDays,
  weekRange,
  type LogMetric,
} from './weeks';

export type Activities = CalendarDay['activities'];

/** A day's colour: its sport's, or a neutral grey when it has more than one activity. */
export function dayColour(c: ReturnType<typeof useTheme>, activities: Activities) {
  if (activities.length > 1) return c.muted;
  return activities[0] ? sportColour(c, activities[0].sport) : c.muted;
}

export const total = (activities: Activities, metric: LogMetric) =>
  activities.reduce((sum, a) => sum + valueOf(a, metric), 0);

export function LogCard() {
  const api = useApi();
  const c = useTheme();
  const today = isoDay(new Date());
  const from = weekAt(1, today);
  const calendar = useQuery(calendarQuery(api, { from, to: addDays(weekAt(0, today), 7) }));
  if (calendar.isPending) return <CardSkeleton lines={4} />;
  const days = new Map((calendar.data as CalendarDay[] | undefined)?.map((d) => [d.day, d.activities]) ?? []);
  const week = (monday: string) => weekDays(monday).map((d) => ({ day: d, activities: days.get(d) ?? [] }));
  const thisWeek = week(weekAt(0, today));
  const lastWeek = week(from);
  const time = (w: typeof thisWeek) =>
    formatHoursMinutes(w.reduce((s, d) => s + total(d.activities, 'time'), 0));
  const line = (label: string, value: string) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: c.fg, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: c.fg, fontSize: 14, fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('progress.log')}: ${t('progress.thisWeek')} ${time(thisWeek)}`}
      onPress={() => router.push('/training-log')}
      style={{ flex: 1 }}
    >
      <Card style={{ flex: 1, marginBottom: 0, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="calendar_month" color={accent(c)} size={22} />
          <Text numberOfLines={1} style={{ flex: 1, color: c.fg, fontSize: 16, fontWeight: '700' }}>
            {t('progress.log')}
          </Text>
          <Icon name="chevron_right" color={c.muted} size={22} />
        </View>
        {line(t('progress.thisWeek'), time(thisWeek))}
        <Dots days={thisWeek} today={today} />
        <Dots days={lastWeek} today={today} />
        {line(t('progress.lastWeek'), time(lastWeek))}
      </Card>
    </Pressable>
  );
}

/** A week as seven dots for the card: a speck on a rest day, a ring today if nothing yet. */
function Dots({ days, today }: { days: { day: string; activities: Activities }[]; today: string }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', height: 28, alignItems: 'center' }}>
      {days.map(({ day, activities }) => {
        const v = total(activities, 'time');
        const size = v ? Math.round(10 + 16 * Math.sqrt(Math.min(1, v / 7200))) : day === today ? 10 : 5;
        return (
          <View key={day} style={{ flex: 1, alignItems: 'center' }}>
            <View
              style={{
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: v ? dayColour(c, activities) : day === today ? 'transparent' : c.muted,
                borderWidth: !v && day === today ? 2 : 0,
                borderColor: c.muted,
              }}
            />
          </View>
        );
      })}
    </View>
  );
}

/** The log screen's week: its days and total, a bubble per day with activity, ▲ under today. */
export function WeekRow({
  monday,
  days,
  metric,
  sport,
  today,
  onDay,
}: {
  monday: string;
  days: Map<string, Activities> | null;
  metric: LogMetric;
  sport: string | null;
  today: string;
  onDay: (activities: Activities) => void;
}) {
  const c = useTheme();
  const format = useFormat();
  const imperial = useUnits() === 'imperial';
  const week = weekDays(monday).map((day) => ({
    day,
    activities: (days?.get(day) ?? []).filter((a) => !sport || asSport(a.sport) === sport),
  }));
  const sum = week.reduce((s, d) => s + total(d.activities, metric), 0);
  const label =
    metric === 'time'
      ? formatHoursMinutes(sum)
      : metric === 'distance'
        ? format.distance(sum)
        : format.elevation(sum);
  return (
    <View style={{ height: ROW_HEIGHT, borderBottomWidth: 1, borderColor: c.line, paddingTop: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: c.fg, fontSize: 14 }}>{weekRange(monday, locale)}</Text>
        <Text style={{ color: c.fg, fontSize: 14, fontVariant: ['tabular-nums'] }}>{days ? label : ''}</Text>
      </View>
      <View style={{ flexDirection: 'row', flex: 1 }}>
        {week.map(({ day, activities }) => {
          const v = total(activities, metric);
          const size = bubbleSize(v, metric);
          const several = activities.length > 1;
          return (
            <View key={day} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              {activities.length && size ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${day}: ${bubbleLabel(v, metric, locale, imperial)}`}
                  onPress={() => onDay(activities)}
                  style={{
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    backgroundColor: dayColour(c, activities),
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      color: several ? c.bg : '#fff',
                      fontSize: 11,
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {bubbleLabel(v, metric, locale, imperial)}
                  </Text>
                  {several && (
                    <View
                      style={{
                        position: 'absolute',
                        top: -4,
                        right: -4,
                        minWidth: 20,
                        height: 20,
                        borderRadius: 10,
                        backgroundColor: c.surface,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ color: c.fg, fontSize: 11, fontWeight: '700' }}>
                        {activities.length}
                      </Text>
                    </View>
                  )}
                </Pressable>
              ) : (
                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: c.muted }} />
              )}
              {day === today && (
                <Text style={{ position: 'absolute', bottom: 6, color: c.fg, fontSize: 11 }}>▲</Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

export const ROW_HEIGHT = 124;

/** A day's activities, to choose one, when a bubble holds several. */
export function DayList({ activities, onOpen }: { activities: Activities; onOpen: (id: number) => void }) {
  const c = useTheme();
  const format = useFormat();
  return (
    <View style={{ paddingHorizontal: 16, gap: 4 }}>
      <Muted style={{ fontSize: 14, marginBottom: 4 }}>
        {t('progress.dayActivities', { count: activities.length })}
      </Muted>
      {activities.map((a) => (
        <Pressable
          key={a.id}
          accessibilityRole="button"
          onPress={() => onOpen(a.id)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}
        >
          <View
            style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: sportColour(c, a.sport) }}
          />
          <Text numberOfLines={1} style={{ flex: 1, color: c.fg, fontSize: 14 }}>
            {a.name ?? t(`sport.${asSport(a.sport)}`)}
          </Text>
          <Muted style={{ fontSize: 13 }}>
            {[a.distance_m ? format.distance(a.distance_m) : null, formatHoursMinutes(a.moving_s)]
              .filter(Boolean)
              .join(' · ')}
          </Muted>
        </Pressable>
      ))}
    </View>
  );
}
