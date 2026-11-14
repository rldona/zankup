/**
 * Progress in detail, from the first card on Progress (as Strava's): a sport (chosen in a sheet with a
 * search), what to measure (time, distance, elevation or activities), a range from 7 days to a year,
 * its total against the span before it or against the same span some years back, the chart, and a
 * sentence on how it went. Touching the chart picks a day or week; its box opens what was done in it.
 */
import { calendarQuery, SPORTS, streakQuery, volumeQuery, type CalendarDay } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useApi } from '../src/auth';
import { Icon, SportIcon } from '../src/Icon';
import { locale, t } from '../src/i18n';
import { asSport } from '../src/prefs';
import { isoDay } from '../src/progress/fitness';
import { Panel } from '../src/progress/Panel';
import {
  bucketValue,
  comparableYears,
  metricsFor,
  percentChange,
  PROGRESS_RANGES,
  rangeOf,
  sportsIn,
  yearsBack,
  type Bucket,
  type Period,
  type ProgressRange,
  type VolumeMetric,
} from '../src/progress/volume';
import { monthLabels, sportIcon, useVolumeFormat, weekTitle } from '../src/progress/VolumeCard';
import { VolumeChart } from '../src/progress/VolumeChart';
import { addDays, mondayOf } from '../src/progress/weeks';
import { ChartSkeleton } from '../src/Skeleton';
import { useTheme } from '../src/theme';
import { accent, InfoButton, Muted, onAccent, Screen } from '../src/ui';

const at = (iso: string) => new Date(`${iso}T12:00:00`);
const longDate = (iso: string) =>
  at(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
const shortDate = (iso: string) =>
  at(iso).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: '2-digit' });

export default function ProgressDetailScreen() {
  const api = useApi();
  const c = useTheme();
  const format = useVolumeFormat();
  const params = useLocalSearchParams<{ sport?: string }>();
  const today = isoDay(new Date());
  const [sport, setSport] = useState<string | null>(params.sport || null);
  const [metric, setMetric] = useState<VolumeMetric>(metricsFor(params.sport || null)[0]);
  const [range, setRange] = useState<ProgressRange>('3m');
  const [compare, setCompare] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [panel, setPanel] = useState<'sport' | 'compare' | 'bucket' | null>(null);

  const { current, previous, unit } = rangeOf(range, today);
  const against: Period = compare ? yearsBack(current, compare) : previous;
  const now = useQuery(volumeQuery(api, current, unit));
  const before = useQuery(volumeQuery(api, against, unit));
  const first = useQuery(streakQuery(api)).data?.first_activity;
  const buckets = (now.data ?? []) as Bucket[];
  const earlier = (before.data ?? []) as Bucket[];
  const value = (b: Bucket) => bucketValue(b, metric, sport, asSport);
  const values = buckets.map(value);
  const previousValues = earlier.map(value);
  const total = values.reduce((a, b) => a + b, 0);
  const previousTotal = previousValues.reduce((a, b) => a + b, 0);
  const pct = percentChange(total, previousTotal);
  const metrics = [...metricsFor(sport), 'count' as const];
  const years = comparableYears(current, first);
  const bucket = picked != null ? buckets[picked] : null;

  const end = unit === 'day' || range === 'ytd' ? t('progress.today') : longDate(addDays(mondayOf(today), 6));
  const ticks = format.ticks(Math.max(0, ...values, ...(compare ? previousValues : [])), metric, 3);
  const labels =
    range === '7d'
      ? buckets.map((b, index) => ({
          index,
          text: at(b.start).toLocaleDateString(locale, { weekday: 'narrow' }).toUpperCase(),
        }))
      : range === '1m'
        ? buckets.flatMap((b, index) =>
            at(b.start).getDay() === 1
              ? [
                  {
                    index,
                    text: at(b.start)
                      .toLocaleDateString(locale, { day: 'numeric', month: 'short' })
                      .replace('.', '')
                      .toUpperCase(),
                  },
                ]
              : [],
          )
        : monthLabels(buckets.map((b) => b.start));
  const periodOf = (b: Bucket) => (unit === 'day' ? longDate(b.start) : weekTitle(b.start));
  const yearsLabel = (k: number) => (k === 1 ? t('progress.lastYear') : t('progress.yearsAgo', { count: k }));

  const glance = (() => {
    const v = format.value(metric, total, 1);
    const p = format.value(metric, previousTotal, 1);
    const period = t(`progress.period.${range}`);
    if (compare) {
      if (pct == null) return t('progress.glance.new', { value: v, period });
      const label = t('progress.glance.compareLabel', { count: compare });
      return t(pct >= 0 ? 'progress.glance.compareUp' : 'progress.glance.compareDown', {
        pct: Math.abs(pct),
        label,
        previous: p,
      });
    }
    if (!total) return t('progress.glance.none', { period });
    if (pct == null) return t('progress.glance.new', { value: v, period });
    if (pct === 0) return t('progress.glance.same', { value: v, period });
    return t(pct > 0 ? 'progress.glance.up' : 'progress.glance.down', {
      value: v,
      period,
      pct: Math.abs(pct),
      previous: p,
    });
  })();

  const pill = (on: boolean, label: string, onPress: () => void, icon?: React.ReactNode) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: on ? accent(c) : c.line,
      }}
    >
      {icon}
      <Text style={{ color: on ? accent(c) : c.fg, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
  const change = (p: number | null) =>
    p == null ? null : (
      <Text
        style={{
          color: p > 0 ? c.formPositive : c.fg,
          fontSize: 17,
          fontWeight: '800',
          fontVariant: ['tabular-nums'],
        }}
      >
        {p > 0 ? '▲' : p < 0 ? '▼' : ''} {Math.abs(p)} %
      </Text>
    );
  const dot = (colour: string) => (
    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colour }} />
  );

  return (
    <Screen header>
      <Stack.Screen options={{ headerRight: () => <InfoButton text={t('progress.volumeInfo')} /> }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {pill(
          true,
          sport ? t(`sport.${asSport(sport)}`) : t('progress.allSports'),
          () => setPanel('sport'),
          <>
            <Icon name={sportIcon(sport)} color={accent(c)} size={16} />
          </>,
        )}
        {metrics.map((m) =>
          pill(
            m === metric,
            t(m === 'ascent' ? 'progress.metricLong.ascent' : `progress.metricShort.${m}`),
            () => {
              setMetric(m);
              setPicked(null);
            },
          ),
        )}
      </ScrollView>

      <Text style={{ color: c.fg, fontSize: 15, fontWeight: '700' }}>{t(`progress.total.${metric}`)}</Text>
      {compare ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ color: c.fg, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                {format.value(metric, total, 1)}
              </Text>
              {change(pct)}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {dot(String(c.accent))}
              <Muted style={{ fontSize: 13 }}>
                {shortDate(current.from)} - {shortDate(addDays(current.to, -1))}
              </Muted>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: c.fg, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
              {format.value(metric, previousTotal, 1)}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {dot(String(c.fatigue))}
              <Muted style={{ fontSize: 13 }}>
                {shortDate(against.from)} - {shortDate(addDays(against.to, -1))}
              </Muted>
            </View>
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <View style={{ flexShrink: 1 }}>
            <Text style={{ color: c.fg, fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
              {format.value(metric, total, 1)}
            </Text>
            <Muted style={{ fontSize: 13 }}>
              {longDate(current.from)} - {end}
            </Muted>
          </View>
          {pct != null && (
            <View style={{ alignItems: 'flex-end' }}>
              {change(pct)}
              <Muted style={{ fontSize: 13 }}>{t(`progress.vs.${range}`)}</Muted>
            </View>
          )}
        </View>
      )}

      {now.isPending ? (
        <ChartSkeleton height={260} />
      ) : (
        <View>
          {bucket && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('progress.weekDetail')}
              onPress={() => setPanel('bucket')}
              style={{
                alignSelf: 'center',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 16,
                marginBottom: 8,
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderRadius: 10,
                backgroundColor: c.surface2,
                borderWidth: 1,
                borderColor: c.line,
              }}
            >
              <View>
                <Text style={{ color: c.fg, fontSize: 18, fontWeight: '800' }}>
                  {format.value(metric, value(bucket), 1)}
                </Text>
                <Muted style={{ fontSize: 13 }}>{periodOf(bucket)}</Muted>
              </View>
              <Icon name="chevron_right" color={c.muted} size={24} />
            </Pressable>
          )}
          <VolumeChart
            values={values}
            previous={compare ? previousValues : null}
            ticks={ticks}
            tickLabel={(v) => format.tick(metric, v)}
            labels={labels}
            picked={picked}
            onPick={setPicked}
            height={260}
            label={`${t(`progress.total.${metric}`)}: ${format.value(metric, total, 1)}`}
          />
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: 6 }}>
        {PROGRESS_RANGES.map((r) => {
          const on = r === range;
          return (
            <Pressable
              key={r}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => {
                setRange(r);
                setPicked(null);
              }}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: 9,
                borderRadius: 999,
                backgroundColor: on ? accent(c) : 'transparent',
              }}
            >
              <Text style={{ color: on ? onAccent(c) : accent(c), fontSize: 14, fontWeight: '800' }}>
                {t(`progress.range.${r}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => setPanel('compare')}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          paddingVertical: 12,
          borderRadius: 999,
          borderWidth: 1.5,
          borderColor: c.line,
          backgroundColor: c.bg,
        }}
      >
        <View style={{ width: 22, height: 5, borderRadius: 3, backgroundColor: c.fatigue }} />
        <Text style={{ color: c.fg, fontSize: 14, fontWeight: '700' }}>
          {compare ? yearsLabel(compare) : t('progress.compare')}
        </Text>
        {compare ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('progress.clearCompare')}
            hitSlop={10}
            onPress={() => setCompare(null)}
          >
            <Icon name="close" color={c.fg} size={22} />
          </Pressable>
        ) : (
          <Icon name="keyboard_arrow_down" color={c.fg} size={22} />
        )}
      </Pressable>

      <View style={{ backgroundColor: c.surface, borderRadius: 18, padding: 20, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name={sportIcon(sport)} color={c.fg} size={22} />
          <Text style={{ color: c.fg, fontSize: 14 }}>{t('progress.glanceTitle')}</Text>
        </View>
        <Text style={{ color: c.fg, fontSize: 16, lineHeight: 26 }}>{glance}</Text>
      </View>

      <Panel open={panel === 'sport'} onClose={() => setPanel(null)}>
        <SportSheet
          sport={sport}
          found={sportsIn([...buckets, ...earlier], SPORTS, asSport)}
          onPick={(s) => {
            setSport(s);
            if (!metricsFor(s).includes(metric as never) && metric !== 'count') setMetric(metricsFor(s)[0]);
            setPicked(null);
            setPanel(null);
          }}
        />
      </Panel>
      <Panel open={panel === 'compare'} onClose={() => setPanel(null)}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }}>
          <Text style={{ color: c.fg, fontSize: 17, fontWeight: '800', marginBottom: 8 }}>
            {t('progress.compareWith')}
          </Text>
          {[null, ...years].map((k) => (
            <Pressable
              key={k ?? 0}
              accessibilityRole="radio"
              accessibilityState={{ checked: compare === k }}
              onPress={() => {
                setCompare(k);
                setPanel(null);
              }}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14 }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.fg, fontSize: 15 }}>
                  {k ? yearsLabel(k) : t('progress.compareNone')}
                </Text>
                {k ? (
                  <Muted style={{ fontSize: 13 }}>
                    {longDate(yearsBack(current, k).from)} - {longDate(addDays(yearsBack(current, k).to, -1))}
                  </Muted>
                ) : null}
              </View>
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  borderWidth: 2,
                  borderColor: compare === k ? accent(c) : c.fg,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {compare === k && (
                  <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: accent(c) }} />
                )}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </Panel>
      <Panel open={panel === 'bucket' && bucket != null} onClose={() => setPanel(null)}>
        {bucket && (
          <BucketSheet
            from={bucket.start}
            to={addDays(bucket.start, unit === 'day' ? 1 : 7)}
            title={periodOf(bucket)}
            sport={sport}
            onOpen={(id) => {
              setPanel(null);
              router.push(`/activity/${id}`);
            }}
          />
        )}
      </Panel>
    </Screen>
  );
}

/** "Filter by sport": every sport, or one, with a search over their names. */
function SportSheet({
  sport,
  found,
  onPick,
}: {
  sport: string | null;
  found: string[];
  onPick: (sport: string | null) => void;
}) {
  const c = useTheme();
  const [query, setQuery] = useState('');
  const list = (found.length ? found : [...SPORTS]).filter((s) =>
    t(`sport.${asSport(s)}`)
      .toLocaleLowerCase(locale)
      .includes(query.trim().toLocaleLowerCase(locale)),
  );
  const row = (s: string | null, title: string, note?: string) => {
    const on = s === sport;
    return (
      <Pressable
        key={s ?? 'all'}
        accessibilityRole="radio"
        accessibilityState={{ checked: on }}
        onPress={() => onPick(s)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14 }}
      >
        <Icon name={sportIcon(s)} color={on ? accent(c) : c.fg} size={26} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: on ? accent(c) : c.fg, fontSize: 15 }}>{title}</Text>
          {note ? <Text style={{ color: on ? accent(c) : c.fg, fontSize: 13 }}>{note}</Text> : null}
        </View>
        {on && <Icon name="check" color={accent(c)} size={26} />}
      </Pressable>
    );
  };
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }}
    >
      <Text style={{ color: c.fg, fontSize: 17, fontWeight: '800', marginBottom: 12 }}>
        {t('progress.filterSport')}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 16,
          borderRadius: 999,
          backgroundColor: c.surface2,
          marginBottom: 6,
        }}
      >
        <Icon name="search" color={c.muted} size={22} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('nav.search')}
          placeholderTextColor={c.muted}
          style={{ flex: 1, color: c.fg, fontSize: 15, paddingVertical: 12 }}
        />
      </View>
      {!query && row(null, t('progress.allSports'), t('progress.allSportsNote'))}
      {list.map((s) => row(s, t(`sport.${asSport(s)}`)))}
    </ScrollView>
  );
}

/** A day's or week's totals and its activities, each opening its page. */
function BucketSheet({
  from,
  to,
  title,
  sport,
  onOpen,
}: {
  from: string;
  to: string;
  title: string;
  sport: string | null;
  onOpen: (id: number) => void;
}) {
  const api = useApi();
  const c = useTheme();
  const format = useVolumeFormat();
  const calendar = useQuery(calendarQuery(api, { from, to }));
  const activities = ((calendar.data ?? []) as CalendarDay[])
    .flatMap((d) => d.activities.map((a) => ({ ...a, day: d.day })))
    .filter((a) => !sport || asSport(a.sport) === sport)
    .reverse();
  const stats = (distance: number, ascent: number, time: number) => (
    <View style={{ flexDirection: 'row', gap: 28 }}>
      {(
        [
          ['distance', distance],
          ['ascent', ascent],
          ['time', time],
        ] as const
      )
        .filter(([m, v]) => m === 'time' || v > 0)
        .map(([m, v]) => (
          <View key={m}>
            <Text style={{ color: c.fg, fontSize: 13 }}>{t(`progress.metricShort.${m}`)}</Text>
            <Text style={{ color: c.fg, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
              {format.value(m, v)}
            </Text>
          </View>
        ))}
    </View>
  );
  const sum = (k: 'distance_m' | 'ascent_m' | 'moving_s') => activities.reduce((s, a) => s + (a[k] ?? 0), 0);
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
      <Text style={{ color: c.fg, fontSize: 17, fontWeight: '800', textAlign: 'center', marginBottom: 12 }}>
        {title}
      </Text>
      <View style={{ backgroundColor: c.bg, paddingHorizontal: 20, paddingVertical: 18 }}>
        {stats(sum('distance_m'), sum('ascent_m'), sum('moving_s'))}
      </View>
      <View style={{ paddingHorizontal: 20 }}>
        {activities.map((a) => (
          <Pressable
            key={a.id}
            accessibilityRole="button"
            onPress={() => onOpen(a.id)}
            style={{ paddingVertical: 16, gap: 12 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <SportIcon sport={asSport(a.sport)} size={48} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: c.fg, fontSize: 16, fontWeight: '700' }}>
                  {a.name ?? t(`sport.${asSport(a.sport)}`)}
                </Text>
                <Muted style={{ fontSize: 13 }}>{longDate(a.day)}</Muted>
              </View>
            </View>
            {stats(a.distance_m ?? 0, a.ascent_m ?? 0, a.moving_s)}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
