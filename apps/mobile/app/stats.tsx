/**
 * Stats (OS-508, OS-519), as in the PWA: the period (last 12 months, a year moved with arrows, a
 * run of months from one to another, or all time) right above everything for the period, the engine's progress while it recomputes, and the
 * way to the calendar, heatmap, routes, segments, reviews and health. All read from what the engine
 * precomputed.
 */
import { engineQuery, monthsRange, periodOf, yearsQuery, type MessageKey } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useApi } from '../src/auth';
import { Icon, type IconName } from '../src/Icon';
import { MenuButton } from '../src/Menu';
import { locale, t } from '../src/i18n';
import {
  CompareWithStrava,
  Curves,
  Now,
  Efficiency,
  Fitness,
  Progress,
  Records,
  Summary,
  Volume,
} from '../src/stats/Sections';
import { useTheme } from '../src/theme';
import { Card, Choice, Heading, MenuRow, Muted, Screen } from '../src/ui';

// Health has its tab and the calendar sits in Activities' header; the reviews and the heatmap are in
// this header. What is left goes under "More".
const LINKS: [IconName, MessageKey, string][] = [
  ['route', 'stats.routes', '/routes'],
  ['timeline', 'stats.segments', '/segments'],
];

const MODES = ['last12', 'year', 'month', 'all'] as const;

/** A month counted from year 0, short: "sep 2026". */
const monthLabel = (month: number) =>
  new Date(Math.floor(month / 12), month % 12, 15)
    .toLocaleDateString(locale, { month: 'short', year: 'numeric' })
    .replace(' de ', ' ')
    .replace('.', '');
type Mode = (typeof MODES)[number];

/** The year or month shown, with an arrow on each side; an arrow at the end of the history is dimmed. */
function Stepper({
  label,
  back,
  forward,
}: {
  label: string;
  back: (() => void) | null;
  forward: (() => void) | null;
}) {
  const c = useTheme();
  const arrow = (name: IconName, onPress: (() => void) | null, a11y: MessageKey) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(a11y)}
      accessibilityState={{ disabled: !onPress }}
      disabled={!onPress}
      onPress={onPress ?? undefined}
      hitSlop={12}
      style={{ opacity: onPress ? 1 : 0.3 }}
    >
      <Icon name={name} color={c.fg} size={28} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      {arrow('chevron_left', back, 'stats.previous')}
      <Text style={{ color: c.fg, fontSize: 16, fontWeight: '700' }}>{label}</Text>
      {arrow('chevron_right', forward, 'stats.next')}
    </View>
  );
}

export default function StatsScreen() {
  const api = useApi();
  const c = useTheme();
  const [today] = useState(() => new Date());
  const years = useQuery(yearsQuery(api));
  const first = years.data?.at(-1) ?? today.getFullYear();
  // The period: a mode, and for a year or a month where the arrows have moved to (months count from
  // year 0, so one step is always one month).
  const [mode, setMode] = useState<Mode>('last12');
  const now = today.getFullYear() * 12 + today.getMonth();
  const [shownYear, setShownYear] = useState(today.getFullYear());
  // Months: from and to, both included; each stops at the other, so the run never turns around.
  const [fromMonth, setFromMonth] = useState(now);
  const [toMonth, setToMonth] = useState(now);
  const choice = mode === 'year' ? String(shownYear) : mode;
  const period = useMemo(
    () => (mode === 'month' ? monthsRange(fromMonth, toMonth) : periodOf(choice, today, first)),
    [mode, fromMonth, toMonth, choice, today, first],
  );
  const range = { from: period.from, to: period.to };
  const engine = useQuery({
    ...engineQuery(api),
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });
  const year =
    mode === 'year' ? String(shownYear) : mode === 'month' ? String(Math.floor(toMonth / 12)) : null;

  return (
    <Screen
      header
      toolbar={
        <>
          <Choice
            label={t('stats.period')}
            value={mode}
            onChange={setMode}
            options={MODES.map((m) => ({ value: m, label: t(`stats.mode.${m}`) }))}
          />
          {mode === 'year' && (
            <Stepper
              label={String(shownYear)}
              back={shownYear > first ? () => setShownYear(shownYear - 1) : null}
              forward={shownYear < today.getFullYear() ? () => setShownYear(shownYear + 1) : null}
            />
          )}
          {mode === 'month' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ flex: 1 }}>
                <Stepper
                  label={monthLabel(fromMonth)}
                  back={fromMonth > first * 12 ? () => setFromMonth(fromMonth - 1) : null}
                  forward={fromMonth < toMonth ? () => setFromMonth(fromMonth + 1) : null}
                />
              </View>
              <Text style={{ color: c.muted }}>–</Text>
              <View style={{ flex: 1 }}>
                <Stepper
                  label={monthLabel(toMonth)}
                  back={toMonth > fromMonth ? () => setToMonth(toMonth - 1) : null}
                  forward={toMonth < now ? () => setToMonth(toMonth + 1) : null}
                />
              </View>
            </View>
          )}
        </>
      }
    >
      {/* Shortcuts: this month's and this year's review, and the heatmap. */}
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20 }}>
              <MenuButton
                icon="summarize"
                label={t('stats.reviews')}
                value=""
                onChange={(href: string) => router.push(href as never)}
                options={[
                  { value: '/review/month', label: t('review.monthLink') },
                  { value: '/review/year', label: t('review.yearLink') },
                ]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('stats.heatmap')}
                hitSlop={10}
                onPress={() => router.push('/heatmap')}
              >
                <Icon name="layers" color={c.fg} size={26} />
              </Pressable>
            </View>
          ),
        }}
      />
      {engine.data?.running && (
        <Muted accessibilityRole="alert">
          {t('stats.recomputing', { done: engine.data.done, total: engine.data.total })}
        </Muted>
      )}

      <Now />
      <Fitness range={range} />
      <Volume range={range} unit={period.unit} />
      <Curves range={range} />
      <Records range={range} />
      <Progress selected={Number(year) || today.getFullYear()} />
      <Efficiency range={range} />
      <CompareWithStrava />
      {/* The period's figures against the year before: a table, after the charts the filters change. */}
      <Summary range={range} />

      <Heading>{t('stats.links')}</Heading>
      <Card style={{ paddingVertical: 0, gap: 0 }}>
        {LINKS.map(([icon, label, href], i) => (
          <MenuRow
            key={href}
            icon={<Icon name={icon} color={c.fg} />}
            label={t(label)}
            onPress={() => router.push(href as never)}
            last={i === LINKS.length - 1}
          />
        ))}
      </Card>
    </Screen>
  );
}
