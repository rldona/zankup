/**
 * Training calendar on the phone (OS-520), as in the PWA (OS-326): a month of weeks, one round sport
 * icon per activity sized by its effort and coloured by sport, the form of each day and the week's
 * totals. Plain arrows beside the month move between months.
 * Tapping a bubble opens the activity; tapping two days sums the days between them.
 */
import {
  calendarQuery,
  formatDuration,
  formatHoursMinutes,
  SPORT_ICONS,
  type CalendarDay,
} from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useApi } from '../src/auth';
import { Icon } from '../src/Icon';
import { locale, t } from '../src/i18n';
import { asSport, useFormat } from '../src/prefs';
import { monthGrid } from '../src/stats/dates';
import { sportColour } from '../src/stats/Sections';
import { useTheme } from '../src/theme';
import { Muted, Screen } from '../src/ui';

export default function CalendarScreen() {
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const now = new Date();
  const [month, setMonth] = useState<[number, number]>([now.getFullYear(), now.getMonth() + 1]);
  const [y, m] = month;
  const [from, to] = monthGrid(y, m);
  const days = useQuery(calendarQuery(api, { from, to }));
  const [selection, setSelection] = useState<[number, number] | null>(null);
  const shift = (delta: number) => {
    const d = new Date(y, m - 1 + delta, 1);
    setMonth([d.getFullYear(), d.getMonth() + 1]);
    setSelection(null);
  };
  const list = days.data ?? [];
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < list.length; i += 7) weeks.push(list.slice(i, i + 7));
  const heaviest = Math.max(1, ...list.flatMap((d) => d.activities.map((a) => a.load ?? 0)));
  const total = (span: CalendarDay[]) => {
    const acts = span.flatMap((d) => d.activities);
    return `${acts.length} · ${format.distance(acts.reduce((s, a) => s + (a.distance_m ?? 0), 0))} · ${formatHoursMinutes(acts.reduce((s, a) => s + a.moving_s, 0))}`;
  };
  const selected = selection ? list.slice(Math.min(...selection), Math.max(...selection) + 1) : [];
  const pick = (index: number) =>
    setSelection((current) =>
      current && current[0] === current[1] && current[0] !== index ? [current[0], index] : [index, index],
    );

  return (
    <Screen header>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('calendar.prev')}
          onPress={() => shift(-1)}
          hitSlop={12}
        >
          <Icon name="chevron_left" color={c.fg} size={28} />
        </Pressable>
        <Text style={{ flex: 1, textAlign: 'center', color: c.fg, fontSize: 17, fontWeight: '700' }}>
          {new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('calendar.next')}
          onPress={() => shift(1)}
          hitSlop={12}
        >
          <Icon name="chevron_right" color={c.fg} size={28} />
        </Pressable>
      </View>
      {selected.length > 1 && (
        <Muted accessibilityRole="alert">
          {t('calendar.selection', { days: selected.length, summary: total(selected) })}
        </Muted>
      )}
      <View style={{ flexDirection: 'row' }}>
        {Array.from({ length: 7 }, (_, i) => (
          <Text key={i} style={{ flex: 1, textAlign: 'center', color: c.muted, fontSize: 11 }}>
            {new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'narrow' })}
          </Text>
        ))}
      </View>
      {weeks.map((week, w) => (
        <View key={week[0]?.day ?? w} style={{ gap: 2 }}>
          <View style={{ flexDirection: 'row', gap: 2 }}>
            {week.map((d, i) => {
              const index = w * 7 + i;
              const inMonth = new Date(`${d.day}T12:00:00`).getMonth() === m - 1;
              const on = selection && index >= Math.min(...selection) && index <= Math.max(...selection);
              return (
                <Pressable
                  key={d.day}
                  accessibilityLabel={`${new Date(`${d.day}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'long' })}, ${d.activities.length}`}
                  onPress={() => pick(index)}
                  style={{
                    flex: 1,
                    minHeight: 64,
                    borderRadius: 8,
                    padding: 3,
                    backgroundColor: on ? c.surface2 : c.surface,
                    opacity: inMonth ? 1 : 0.45,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: c.fg, fontSize: 11, fontWeight: '600' }}>
                      {new Date(`${d.day}T12:00:00`).getDate()}
                    </Text>
                    {d.tsb != null && (
                      <Text style={{ color: d.tsb >= 0 ? c.formPositive : c.formNegative, fontSize: 9 }}>
                        {d.tsb > 0 ? '+' : ''}
                        {d.tsb.toFixed(0)}
                      </Text>
                    )}
                  </View>
                  <View
                    style={{
                      flexDirection: 'row',
                      flexWrap: 'wrap',
                      gap: 2,
                      alignItems: 'center',
                      justifyContent: 'center',
                      flex: 1,
                    }}
                  >
                    {d.activities.map((a) => {
                      // Big enough for the sport's icon to read, bigger with the effort.
                      const size = 18 + 10 * Math.sqrt((a.load ?? 10) / heaviest);
                      return (
                        <Pressable
                          key={a.id}
                          accessibilityRole="link"
                          accessibilityLabel={`${a.name ?? t(`sport.${asSport(a.sport)}`)} · ${formatDuration(a.moving_s)}`}
                          onPress={() => router.push(`/activity/${a.id}`)}
                          hitSlop={4}
                          style={{
                            width: size,
                            height: size,
                            borderRadius: size / 2,
                            backgroundColor: sportColour(c, a.sport),
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Icon name={SPORT_ICONS[asSport(a.sport)]} color="#ffffff" size={size * 0.62} />
                        </Pressable>
                      );
                    })}
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Text style={{ color: c.muted, fontSize: 11, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
            {t('calendar.week')}: {total(week)}
          </Text>
        </View>
      ))}
    </Screen>
  );
}
