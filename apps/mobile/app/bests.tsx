/**
 * Best times, from Progress (as Strava's): one measure (a run distance, a ride's best power over a
 * duration or its distance) with two tabs. Analysis: the record and the second and third, a chart of
 * the bests over the last twelve months or a year, and the bests by year, each with its medal of the
 * year. Top 10: the ten best. Each best opens its activity.
 */
import { bestsQuery, effortShown, SPORT_ICONS } from '@zankup/core';
import { Canvas, Circle, Line, Path, vec } from '@shopify/react-native-skia';
import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useApi } from '../src/auth';
import { useCanvasReady } from '../src/charts';
import { Icon } from '../src/Icon';
import { locale, t } from '../src/i18n';
import { useFormat, useUnits } from '../src/prefs';
import {
  bestsIn,
  bestValue,
  lowerIsBetter,
  placeOf,
  ranked,
  RIDE_KEYS,
  RUN_KEYS,
  RUN_METRES,
  yearMedal,
  yearsOf,
  type Best,
} from '../src/progress/bests';
import { bestName, Medal, MEDAL_COLOURS, sportOf } from '../src/progress/BestsCard';
import { Chip, CHIP_ICON } from '../src/progress/Chip';
import { isoDay } from '../src/progress/fitness';
import { Panel } from '../src/progress/Panel';
import { racePace, smoothPath } from '../src/progress/raceTimes';
import { ChartSkeleton } from '../src/Skeleton';
import { useTheme } from '../src/theme';
import { accent, InfoButton, Muted } from '../src/ui';

const day = (iso: string, withYear = true) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
  });

export default function BestsScreen() {
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const imperial = useUnits() === 'imperial';
  const params = useLocalSearchParams<{ key?: string }>();
  const today = isoDay(new Date());
  const [key, setKey] = useState(params.key ?? '5k');
  const [tab, setTab] = useState<'analysis' | 'top'>('analysis');
  const [year, setYear] = useState<string | null>(null);
  const [panel, setPanel] = useState<'sport' | 'year' | null>(null);
  const sport = sportOf(key);
  const keys = (sport === 'run' ? [...RUN_KEYS] : [...RIDE_KEYS]).filter((k) => effortShown(k, format.unit));
  const bests = useQuery(bestsQuery(api, key));
  const all = (bests.data ?? []) as Best[];
  const top = ranked(key, all);
  const value = (v: number) => bestValue(key, v, locale, imperial);
  const pace = (v: number) =>
    sport === 'run' ? `${racePace(v, RUN_METRES[key] ?? 1000, imperial)} /${imperial ? 'mi' : 'km'}` : null;
  const open = (b: Best) => router.push(`/activity/${b.activity_id}`);

  const pick = (k: string) => {
    setKey(k);
    setYear(null);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen
        options={{ title: bestName(key), headerRight: () => <InfoButton text={t('progress.bestsInfo')} /> }}
      />
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: c.line }}>
        {(['analysis', 'top'] as const).map((tb) => {
          const on = tb === tab;
          return (
            <Pressable
              key={tb}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => setTab(tb)}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: 12,
                borderBottomWidth: 3,
                borderColor: on ? accent(c) : 'transparent',
              }}
            >
              <Text style={{ color: on ? c.fg : c.muted, fontSize: 15, fontWeight: '700' }}>
                {t(tb === 'analysis' ? 'progress.analysis' : 'progress.top10')}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 12 }}
      >
        <Chip
          on={false}
          role="button"
          label={t(`sport.${sport}`)}
          icon={(colour) => (
            <>
              <Icon name={SPORT_ICONS[sport]} color={colour} size={CHIP_ICON} />
            </>
          )}
          onPress={() => setPanel('sport')}
        />
        {keys.map((k) => (
          <Chip key={k} on={k === key} label={bestName(k)} onPress={() => pick(k)} />
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {bests.isPending ? (
          <View style={{ padding: 16 }}>
            <ChartSkeleton height={300} />
          </View>
        ) : !top.length ? (
          <Muted style={{ padding: 16 }}>{t('progress.noBests')}</Muted>
        ) : tab === 'analysis' ? (
          <>
            <View style={{ paddingHorizontal: 16, gap: 4 }}>
              <Text style={{ color: c.fg, fontSize: 15, fontWeight: '700' }}>{t('progress.allTime')}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Medal rank={1} size={52} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <Text
                      style={{ color: c.fg, fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] }}
                    >
                      {value(top[0].value)}
                    </Text>
                    {pace(top[0].value) && <Muted style={{ fontSize: 15 }}>{pace(top[0].value)}</Muted>}
                  </View>
                  <Muted style={{ fontSize: 13 }}>{day(top[0].day)}</Muted>
                </View>
                {top.slice(1, 3).map((b, i) => (
                  <View key={b.activity_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                    <Medal rank={i + 2} size={24} />
                    <Text style={{ color: c.fg, fontSize: 13, fontVariant: ['tabular-nums'] }}>
                      {value(b.value)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
            <BestsChart bestKey={key} all={all} shown={bestsIn(all, year, today)} label={value} />
            <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setPanel('year')}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 8,
                  paddingVertical: 12,
                  borderRadius: 999,
                  borderWidth: 1.25,
                  borderColor: c.line,
                }}
              >
                <Text style={{ color: c.fg, fontSize: 14, fontWeight: '700' }}>
                  {year ?? t('progress.filterYear')}
                </Text>
                <Icon name="keyboard_arrow_down" color={c.fg} size={22} />
              </Pressable>
            </View>
            {(year ? [year] : yearsOf(all)).map((y) => (
              <View key={y}>
                <Text
                  style={{
                    color: c.fg,
                    fontSize: 15,
                    fontWeight: '800',
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    backgroundColor: c.surface,
                  }}
                >
                  {y}
                </Text>
                {all
                  .filter((b) => b.day.startsWith(y))
                  .sort((a, b) => (a.day < b.day ? 1 : -1))
                  .map((b) => {
                    const medal = yearMedal(key, all, b);
                    return (
                      <Pressable
                        key={b.activity_id}
                        accessibilityRole="button"
                        onPress={() => open(b)}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 10,
                          paddingHorizontal: 16,
                          paddingVertical: 14,
                          borderBottomWidth: 1,
                          borderColor: c.line,
                        }}
                      >
                        <Text style={{ flex: 1, color: c.fg, fontSize: 15 }}>{day(b.day, false)}</Text>
                        {medal && (
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 2,
                              paddingHorizontal: 6,
                              paddingVertical: 2,
                              borderRadius: 6,
                              backgroundColor: c.surface2,
                            }}
                          >
                            <Medal rank={medal} size={22} />
                            <Text style={{ color: c.fg, fontSize: 13, fontWeight: '700' }}>{y}</Text>
                          </View>
                        )}
                        <Text style={{ color: c.fg, fontSize: 15, fontVariant: ['tabular-nums'] }}>
                          {value(b.value)}
                        </Text>
                        {pace(b.value) && (
                          <Muted style={{ width: 82, textAlign: 'right', fontSize: 14 }}>
                            {pace(b.value)}
                          </Muted>
                        )}
                      </Pressable>
                    );
                  })}
              </View>
            ))}
          </>
        ) : (
          top.slice(0, 10).map((b) => {
            const place = placeOf(key, all, b);
            return (
              <Pressable
                key={b.activity_id}
                accessibilityRole="button"
                onPress={() => open(b)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 16,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                }}
              >
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: place <= 3 ? `${MEDAL_COLOURS[place - 1]}33` : c.surface,
                  }}
                >
                  {place <= 3 ? (
                    <Medal rank={place} size={36} />
                  ) : (
                    <Text style={{ color: c.fg, fontSize: 18, fontWeight: '800' }}>{place}</Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{ color: c.fg, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] }}
                  >
                    {value(b.value)}
                  </Text>
                  <Muted style={{ fontSize: 13 }}>
                    {[pace(b.value), day(b.day)].filter(Boolean).join(' · ')}
                  </Muted>
                </View>
                <Icon name="chevron_right" color={c.muted} size={22} />
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <Panel open={panel === 'sport'} onClose={() => setPanel(null)}>
        <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
          <Text style={{ color: c.fg, fontSize: 17, fontWeight: '800', marginBottom: 8 }}>
            {t('progress.filterSport')}
          </Text>
          {(['run', 'ride'] as const).map((s) => {
            const on = s === sport;
            return (
              <Pressable
                key={s}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => {
                  pick(s === 'run' ? '5k' : 'longest');
                  setPanel(null);
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14 }}
              >
                <Icon name={SPORT_ICONS[s]} color={on ? accent(c) : c.fg} size={26} />
                <Text style={{ flex: 1, color: on ? accent(c) : c.fg, fontSize: 15 }}>{t(`sport.${s}`)}</Text>
                {on && <Icon name="check" color={accent(c)} size={26} />}
              </Pressable>
            );
          })}
        </View>
      </Panel>
      <Panel open={panel === 'year'} onClose={() => setPanel(null)}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }}>
          {[null, ...yearsOf(all)].map((y) => (
            <Pressable
              key={y ?? 'last'}
              accessibilityRole="radio"
              accessibilityState={{ checked: y === year }}
              onPress={() => {
                setYear(y);
                setPanel(null);
              }}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14 }}
            >
              <Text style={{ flex: 1, color: y === year ? accent(c) : c.fg, fontSize: 15 }}>
                {y ?? t('progress.last12Months')}
              </Text>
              {y === year && <Icon name="check" color={accent(c)} size={24} />}
            </Pressable>
          ))}
        </ScrollView>
      </Panel>
    </View>
  );
}

/**
 * The bests of the range by date, joined by a smooth line, the better ones higher (a faster time or
 * more watts); the year's medals in their colours. The axis goes from the slowest shown to the record.
 */
function BestsChart({
  bestKey,
  all,
  shown,
  label,
}: {
  bestKey: string;
  all: Best[];
  shown: Best[];
  label: (v: number) => string;
}) {
  const c = useTheme();
  const [width, setWidth] = useState(0);
  const ready = useCanvasReady(width);
  const height = 260;
  const axis = 70;
  const top = 14;
  const base = height - 34;
  const points = [...shown].sort((a, b) => (a.day < b.day ? -1 : 1));
  if (!points.length) return null;
  const lower = lowerIsBetter(bestKey);
  const record = ranked(bestKey, all)[0].value;
  const worst = points.reduce((w, b) => (lower ? Math.max(w, b.value) : Math.min(w, b.value)), record);
  const span = Math.abs(worst - record) || Math.abs(record) * 0.1 || 1;
  // Better is higher: the record at the top, the worst shown at the bottom.
  const y = (v: number) => top + (Math.abs(v - record) / span) * (base - top);
  const plot = Math.max(1, width - axis - 16);
  const x = (i: number) => axis + 8 + (points.length > 1 ? (i / (points.length - 1)) * plot : plot / 2);
  const middle = lower ? (record + worst) / 2 : (record + worst) / 2;
  const medal = (b: Best) => yearMedal(bestKey, all, b);
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height, marginTop: 16, opacity: ready ? 1 : 0 }}
    >
      {width > 0 && (
        <>
          <Canvas style={{ width, height }}>
            {ready && (
              <>
                {[record, middle, worst].map((v, i) => (
                  <Line key={i} p1={vec(axis, y(v))} p2={vec(width, y(v))} color={c.line} strokeWidth={1} />
                ))}
                {points.map((_, i) => (
                  <Line
                    key={`v${i}`}
                    p1={vec(x(i), top)}
                    p2={vec(x(i), base)}
                    color={c.line}
                    strokeWidth={1}
                  />
                ))}
                <Path
                  path={smoothPath(points.map((b, i) => ({ x: x(i), y: y(b.value) })))}
                  style="stroke"
                  strokeWidth={2.5}
                  color={String(c.fitness)}
                />
                {points.map((b, i) => {
                  const m = medal(b);
                  return (
                    <Circle
                      key={b.activity_id}
                      cx={x(i)}
                      cy={y(b.value)}
                      r={6}
                      color={m ? MEDAL_COLOURS[m - 1] : String(c.muted)}
                    />
                  );
                })}
              </>
            )}
          </Canvas>
          {[record, middle, worst].map((v, i) => (
            <Text
              key={i}
              style={{
                position: 'absolute',
                left: 4,
                top: y(v) - 9,
                color: c.fg,
                fontSize: 12,
                fontVariant: ['tabular-nums'],
              }}
            >
              {label(v)}
            </Text>
          ))}
          <Muted style={{ position: 'absolute', left: axis + 8, top: base + 10, fontSize: 12 }}>
            {day(points[0].day)} – {day(points[points.length - 1].day)}
          </Muted>
        </>
      )}
    </View>
  );
}
