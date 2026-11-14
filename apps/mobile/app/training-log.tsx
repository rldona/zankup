/**
 * Training log, from Progress (as Strava's): every week from this one back to the first activity, a
 * bubble per day sized and labelled by time, distance or elevation, coloured by sport. In the header:
 * filters (sport and what the bubbles show), a list of months to jump to, and the search (Activities).
 * Weeks load eight at a time as they scroll into view; a bubble opens its activity, or lists the day's.
 */
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { calendarQuery, SPORTS, streakQuery, type CalendarDay } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useApi } from '../src/auth';
import { Icon } from '../src/Icon';
import { locale, t } from '../src/i18n';
import { isoDay } from '../src/progress/fitness';
import { addDays, indexOfWeek, weekAt, weekCount, weekDays, type LogMetric } from '../src/progress/weeks';
import { DayList, ROW_HEIGHT, WeekRow, type Activities } from '../src/progress/Log';
import { Panel } from '../src/progress/Panel';
import { useTheme } from '../src/theme';
import { Choice } from '../src/ui';

/** Weeks fetched together, so scrolling asks the server once every eight weeks. */
const CHUNK = 8;

export default function TrainingLogScreen() {
  const api = useApi();
  const c = useTheme();
  const today = isoDay(new Date());
  const streak = useQuery(streakQuery(api));
  const count = weekCount(streak.data?.first_activity, today);
  const [metric, setMetric] = useState<LogMetric>('time');
  const [sport, setSport] = useState<string | null>(null);
  const [panel, setPanel] = useState<'filters' | 'months' | null>(null);
  const [day, setDay] = useState<Activities | null>(null);
  const list = useRef<FlashListRef<number>>(null);
  const letters = weekDays(weekAt(0, today)).map((d) =>
    new Date(`${d}T12:00:00`).toLocaleDateString(locale, { weekday: 'narrow' }).toUpperCase(),
  );

  const open = (activities: Activities) => {
    if (activities.length === 1) router.push(`/activity/${activities[0].id}`);
    else setDay(activities);
  };
  const action = (icon: 'tune' | 'calendar_month' | 'search', label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={10} onPress={onPress}>
      <Icon name={icon} color={c.fg} size={26} />
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 22 }}>
              {action('tune', t('progress.filters'), () => setPanel('filters'))}
              {action('calendar_month', t('progress.goToMonth'), () => setPanel('months'))}
              {action('search', t('nav.search'), () => router.push('/(tabs)/activities'))}
            </View>
          ),
        }}
      />
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10 }}>
        {letters.map((l, i) => (
          <Text key={i} style={{ flex: 1, textAlign: 'center', color: c.fg, fontSize: 13 }}>
            {l}
          </Text>
        ))}
      </View>
      <FlashList
        ref={list}
        data={Array.from({ length: count }, (_, i) => i)}
        keyExtractor={(i) => String(i)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        renderItem={({ item }) => (
          <Week index={item} today={today} metric={metric} sport={sport} onDay={open} />
        )}
      />

      <Panel open={panel === 'filters'} onClose={() => setPanel(null)}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, gap: 14, paddingBottom: 8 }}>
          <Text style={{ color: c.fg, fontSize: 17, fontWeight: '800', textAlign: 'center' }}>
            {t('progress.filters')}
          </Text>
          <Text style={{ color: c.fg, fontSize: 14, fontWeight: '600' }}>{t('progress.activityType')}</Text>
          <Choice
            label={t('progress.activityType')}
            value={sport ?? 'all'}
            onChange={(v) => setSport(v === 'all' ? null : v)}
            options={[
              { value: 'all', label: t('progress.all') },
              ...SPORTS.map((s) => ({ value: s, label: t(`sport.${s}`) })),
            ]}
          />
          <Text style={{ color: c.fg, fontSize: 14, fontWeight: '600' }}>{t('progress.data')}</Text>
          <Choice
            label={t('progress.data')}
            value={metric}
            onChange={setMetric}
            options={(['time', 'distance', 'ascent'] as const).map((m) => ({
              value: m,
              label: t(`progress.metric.${m}`),
            }))}
          />
        </ScrollView>
      </Panel>

      <Panel open={panel === 'months'} side="right" onClose={() => setPanel(null)}>
        <Months
          first={streak.data?.first_activity ?? today}
          today={today}
          onPick={(iso) => {
            setPanel(null);
            list.current?.scrollToIndex({
              index: Math.min(count - 1, indexOfWeek(iso, today)),
              animated: true,
            });
          }}
        />
      </Panel>

      <Panel open={day !== null} onClose={() => setDay(null)}>
        {day && (
          <DayList
            activities={day}
            onOpen={(id) => {
              setDay(null);
              router.push(`/activity/${id}`);
            }}
          />
        )}
      </Panel>
    </View>
  );
}

/** One week, with the days of its chunk of eight (fetched once for the eight). */
function Week({
  index,
  today,
  metric,
  sport,
  onDay,
}: {
  index: number;
  today: string;
  metric: LogMetric;
  sport: string | null;
  onDay: (activities: Activities) => void;
}) {
  const api = useApi();
  const chunk = Math.floor(index / CHUNK);
  const from = weekAt(chunk * CHUNK + CHUNK - 1, today);
  const to = addDays(weekAt(chunk * CHUNK, today), 7);
  const calendar = useQuery(calendarQuery(api, { from, to }));
  const days = calendar.data
    ? new Map((calendar.data as CalendarDay[]).map((d) => [d.day, d.activities]))
    : null;
  return (
    <View style={{ height: ROW_HEIGHT }}>
      <WeekRow
        monday={weekAt(index, today)}
        days={days}
        metric={metric}
        sport={sport}
        today={today}
        onDay={onDay}
      />
    </View>
  );
}

/** Every month from this one back to the first activity's, under its year; a tap goes to its first week. */
function Months({ first, today, onPick }: { first: string; today: string; onPick: (iso: string) => void }) {
  const c = useTheme();
  const months: { year: number; month: number }[] = [];
  const end = new Date(`${first.slice(0, 7)}-15T12:00:00`);
  for (let d = new Date(`${today.slice(0, 7)}-15T12:00:00`); d >= end; d.setMonth(d.getMonth() - 1))
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  return (
    <ScrollView>
      {months.map(({ year, month }, i) => {
        const iso = `${year}-${String(month).padStart(2, '0')}-01`;
        const newYear = i === 0 || months[i - 1].year !== year;
        return (
          <View key={iso}>
            {newYear && (
              <Text style={{ color: c.fg, fontSize: 18, fontWeight: '800', padding: 16, paddingBottom: 12 }}>
                {year}
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              onPress={() => onPick(iso < first ? first : iso)}
              style={{ paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderColor: c.line }}
            >
              <Text style={{ color: c.fg, fontSize: 15 }}>
                {new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { month: 'long' })}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}
