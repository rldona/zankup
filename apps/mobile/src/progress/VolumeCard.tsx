/**
 * Progress's first card (as Strava's): a chip per sport, this week's totals (or the week touched on the
 * chart) and the last 12 weeks of the sport's main measure, with a way into the detail screen.
 */
import { SPORT_ICONS, SPORTS, volumeQuery } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useApi } from '../auth';
import { Icon, type IconName } from '../Icon';
import { locale, t } from '../i18n';
import { asSport, useUnits } from '../prefs';
import { CardSkeleton } from '../Skeleton';
import { useTheme } from '../theme';
import { accent, Card } from '../ui';
import { isoDay } from './fitness';
import {
  axisTicks,
  bucketValue,
  hoursMinutes,
  metricsFor,
  sportsIn,
  type Bucket,
  type VolumeMetric,
} from './volume';
import { VolumeChart } from './VolumeChart';
import { addDays, weekAt } from './weeks';

const MILE = 1609.344;

/** Totals, axis labels and dates written for the person's units and language. */
export function useVolumeFormat() {
  const imperial = useUnits() === 'imperial';
  const distanceUnit = imperial ? MILE : 1000;
  const n = (v: number, digits = 0) =>
    v.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return {
    imperial,
    /** A total: 4h 17min · 28,97 km · 1.421 m · 22. */
    value(metric: VolumeMetric, v: number, digits = 2) {
      if (metric === 'time') return hoursMinutes(v);
      if (metric === 'distance') return `${n(v / distanceUnit, v ? digits : 0)} ${imperial ? 'mi' : 'km'}`;
      if (metric === 'ascent') return `${n(imperial ? v * 3.28084 : v)} ${imperial ? 'ft' : 'm'}`;
      return n(v);
    },
    /** An axis label: 4h 0min · 30 km · 2.500 m · 5. */
    tick(metric: VolumeMetric, v: number) {
      if (metric === 'time') return hoursMinutes(v);
      if (metric === 'distance')
        return `${n(v / distanceUnit, Number.isInteger(v / distanceUnit) ? 0 : 1)} ${imperial ? 'mi' : 'km'}`;
      if (metric === 'ascent') return `${n(v)} ${imperial ? 'ft' : 'm'}`;
      return n(v);
    },
    /** Ticks in the person's units (miles and feet round as miles and feet). */
    ticks(max: number, metric: VolumeMetric, intervals: number) {
      if (metric === 'ascent' && imperial)
        return axisTicks(max * 3.28084, 'ascent', intervals).map((v) => v / 3.28084);
      return axisTicks(max, metric, intervals, metric === 'distance' && imperial ? MILE / 1000 : 1);
    },
  };
}

/** "7 sept - 13 sept 2026": a week as the headers write it. */
export function weekTitle(monday: string) {
  const day = (iso: string, year = false) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
      ...(year ? { year: 'numeric' } : {}),
    });
  return `${day(monday)} - ${day(addDays(monday, 6), true)}`;
}

/** Months under a weekly chart: one where a month starts, as SEP · OCT · NOV. */
export function monthLabels(starts: string[]) {
  return starts.flatMap((s, i) =>
    i > 0 && s.slice(5, 7) !== starts[i - 1].slice(5, 7)
      ? [
          {
            index: i,
            text: new Date(`${s}T12:00:00`)
              .toLocaleDateString(locale, { month: 'short' })
              .replace('.', '')
              .toUpperCase(),
          },
        ]
      : [],
  );
}

/** A sport's chip or row icon, and the all-sports one. */
export const sportIcon = (sport: string | null): IconName =>
  sport ? SPORT_ICONS[asSport(sport)] : 'monitoring';

export function VolumeCard() {
  const api = useApi();
  const c = useTheme();
  const format = useVolumeFormat();
  const today = isoDay(new Date());
  const volume = useQuery(volumeQuery(api, { from: weekAt(11, today), to: addDays(today, 1) }, 'week'));
  const [sport, setSport] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  if (volume.isPending) return <CardSkeleton lines={6} />;
  const buckets = (volume.data ?? []) as Bucket[];
  const sports = sportsIn(buckets, SPORTS, asSport);
  const metrics = metricsFor(sport);
  const chartMetric = metrics[0];
  const valueOf = (b: Bucket, m: VolumeMetric) => bucketValue(b, m, sport, asSport);
  const last = buckets.length - 1;
  const index = picked ?? last;
  const week = buckets[index];
  const values = buckets.map((b) => valueOf(b, chartMetric));
  const ticks = format.ticks(Math.max(...values, 0), chartMetric, 2);

  const chip = (s: string | null) => {
    const on = s === sport;
    return (
      <Pressable
        key={s ?? 'all'}
        accessibilityRole="radio"
        accessibilityState={{ checked: on }}
        onPress={() => {
          setSport(s);
          setPicked(null);
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: 999,
          borderWidth: 1.5,
          borderColor: on ? accent(c) : c.line,
        }}
      >
        <Icon name={sportIcon(s)} color={on ? accent(c) : c.fg} size={20} />
        <Text style={{ color: on ? accent(c) : c.fg, fontSize: 14 }}>
          {s ? t(`sport.${asSport(s)}`) : t('progress.allSports')}
        </Text>
      </Pressable>
    );
  };

  return (
    <Card style={{ gap: 14 }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="radiogroup"
        contentContainerStyle={{ gap: 8 }}
      >
        {chip(null)}
        {sports.map(chip)}
      </ScrollView>
      <Text style={{ color: c.fg, fontSize: 18, fontWeight: '800' }}>
        {index === last ? t('progress.thisWeek') : week ? weekTitle(week.start) : ''}
      </Text>
      <View style={{ flexDirection: 'row', gap: 28, flexWrap: 'wrap' }}>
        {metrics.map((m) => (
          <View key={m}>
            <Text style={{ color: c.fg, fontSize: 13 }}>{t(`progress.metricShort.${m}`)}</Text>
            <Text style={{ color: c.fg, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
              {format.value(m, week ? valueOf(week, m) : 0)}
            </Text>
          </View>
        ))}
      </View>
      <Text style={{ color: c.fg, fontSize: 13 }}>{t('progress.last12Weeks')}</Text>
      <VolumeChart
        values={values}
        ticks={ticks}
        tickLabel={(v) => format.tick(chartMetric, v)}
        labels={monthLabels(buckets.map((b) => b.start))}
        picked={index}
        onPick={setPicked}
        height={190}
        label={`${t('progress.last12Weeks')}: ${values.map((v) => format.value(chartMetric, v)).join(', ')}`}
      />
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/progress-detail', params: sport ? { sport } : {} })}
        style={{
          alignItems: 'center',
          paddingVertical: 14,
          borderRadius: 999,
          borderWidth: 1.5,
          borderColor: c.line,
          backgroundColor: c.bg,
        }}
      >
        <Text style={{ color: c.fg, fontSize: 14, fontWeight: '700' }}>{t('progress.moreDetail')}</Text>
      </Pressable>
    </Card>
  );
}
