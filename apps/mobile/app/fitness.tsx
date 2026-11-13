/**
 * Training, from Progress's Fitness card: the fitness score over a month to two years, how much it changed
 * from the first day of the range to the day picked (today unless another is touched), and that day's
 * activities.
 */
import { calendarQuery, fitnessQuery, type CalendarDay } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useApi } from '../src/auth';
import { Icon, SportIcon } from '../src/Icon';
import { locale, t } from '../src/i18n';
import { asSport } from '../src/prefs';
import {
  fitnessChange,
  FITNESS_RANGES,
  isoDay,
  rangePeriod,
  untilToday,
  type FitnessRange,
} from '../src/progress/fitness';
import { FitnessChart } from '../src/progress/FitnessChart';
import { ChartSkeleton } from '../src/Skeleton';
import { useTheme } from '../src/theme';
import { InfoButton, Muted, Screen } from '../src/ui';

const date = (iso: string, withYear = false) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  });

const month = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { month: 'short' });

export default function FitnessScreen() {
  const api = useApi();
  const c = useTheme();
  const [range, setRange] = useState<FitnessRange>('1m');
  const fitness = useQuery(fitnessQuery(api, rangePeriod(range, new Date())));
  const days = untilToday(fitness.data ?? [], new Date());
  const last = days.length - 1;
  // The day touched on the chart; none means the last one (today).
  const [picked, setPicked] = useState<number | null>(null);
  const index = Math.max(0, Math.min(picked ?? last, last));
  const day = days[index];
  const today = isoDay(new Date());
  const change = day ? fitnessChange(days[0].ctl, day.ctl) : null;
  const short = range === '1m' || range === '3m';
  const labels = days.map((d) => (d.day === today ? t('home.today') : short ? date(d.day) : month(d.day)));

  return (
    <Screen header>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ color: c.fg, fontSize: 24, fontWeight: '800' }}>{t('progress.fitness')}</Text>
        <InfoButton text={t('progress.fitnessInfo')} />
      </View>
      <Text style={{ color: c.fg, fontSize: 15, lineHeight: 21 }}>{t('progress.fitnessIntro')}</Text>

      <View
        accessibilityRole="tablist"
        style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: c.line, marginHorizontal: -16 }}
      >
        {FITNESS_RANGES.map((r) => {
          const on = r === range;
          return (
            <Pressable
              key={r}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => {
                setRange(r);
                setPicked(null);
              }}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: 12,
                borderBottomWidth: 3,
                borderColor: on ? String(c.fitness) : 'transparent',
              }}
            >
              <Text style={{ color: on ? c.fg : c.muted, fontSize: 15, fontWeight: on ? '700' : '400' }}>
                {t(`progress.range.${r}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {fitness.isPending ? (
        <ChartSkeleton height={360} />
      ) : !day || !change ? (
        <Muted>{t('progress.noFitness')}</Muted>
      ) : (
        <>
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Text style={{ color: c.fg, fontSize: 40, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                {change.direction === 'up' ? '▴' : change.direction === 'down' ? '▾' : ''}
                {change.percent} %
              </Text>
              <Text
                style={{
                  color: change.direction === 'up' ? c.formPositive : c.fg,
                  fontSize: 15,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {change.direction === 'none'
                  ? t('progress.noChange')
                  : t('progress.points', { points: change.points > 0 ? `+${change.points}` : change.points })}
              </Text>
            </View>
            <Text style={{ color: c.fg, fontSize: 15 }}>
              {index === last
                ? t(`progress.last.${range}`)
                : t('progress.between', { from: date(days[0].day), to: date(day.day) })}
            </Text>
          </View>
          <FitnessChart
            values={days.map((d) => d.ctl)}
            loads={days.map((d) => d.load)}
            labels={labels}
            picked={index}
            onPick={setPicked}
            showLoads={range === '1m'}
            label={`${t('progress.fitness')} ${Math.round(day.ctl)}, ${date(day.day, true)}`}
          />
          <DayActivities day={day.day} />
        </>
      )}
    </Screen>
  );
}

/** The picked day's activities, each opening its page; "No activities" and the date otherwise. */
function DayActivities({ day }: { day: string }) {
  const api = useApi();
  const c = useTheme();
  const next = isoDay(new Date(new Date(`${day}T12:00:00`).getTime() + 86_400_000));
  const calendar = useQuery(calendarQuery(api, { from: day, to: next }));
  const activities =
    (calendar.data as CalendarDay[] | undefined)?.find((d) => d.day === day)?.activities ?? [];
  const when = new Date(`${day}T12:00:00`).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  if (!activities.length)
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 4 }}>
        <Icon name="timeline" color={c.muted} size={30} />
        <View>
          <Text style={{ color: c.muted, fontSize: 17 }}>{t('progress.noActivities')}</Text>
          <Muted style={{ fontSize: 14 }}>{when}</Muted>
        </View>
      </View>
    );
  return (
    <View style={{ gap: 12 }}>
      {activities.map((a) => (
        <Pressable
          key={a.id}
          accessibilityRole="button"
          onPress={() => router.push(`/activity/${a.id}`)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 4 }}
        >
          <SportIcon sport={asSport(a.sport)} size={36} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: c.fg, fontSize: 17 }}>
              {a.name ?? a.sport}
            </Text>
            <Muted style={{ fontSize: 14 }}>{when}</Muted>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
