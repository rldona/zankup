/**
 * Stats (OS-508, OS-519), as in the PWA: the period (last 12 months, all time, a year or one of its
 * months), the engine's progress while it recomputes, "Now", then everything for the period, and the
 * way to the calendar, heatmap, routes, segments, reviews and health. All read from what the engine
 * precomputed.
 */
import { engineQuery, periodOf, yearsQuery, type MessageKey } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';

import { useApi } from '../../src/auth';
import { Icon, type IconName } from '../../src/Icon';
import { locale, t } from '../../src/i18n';
import {
  CompareWithStrava,
  Curves,
  Efficiency,
  Fitness,
  Now,
  Progress,
  Records,
  Summary,
  Volume,
} from '../../src/stats/Sections';
import { useTheme } from '../../src/theme';
import { Card, Choice, Heading, MenuRow, Muted, Screen, Title } from '../../src/ui';

const LINKS: [IconName, MessageKey, string][] = [
  ['summarize', 'review.monthLink', '/review/month'],
  ['trophy', 'review.yearLink', '/review/year'],
  ['monitor_heart', 'nav.health', '/health'],
  ['calendar_month', 'stats.calendar', '/calendar'],
  ['layers', 'stats.heatmap', '/heatmap'],
  ['route', 'stats.routes', '/routes'],
  ['timeline', 'stats.segments', '/segments'],
];

export default function StatsScreen() {
  const api = useApi();
  const c = useTheme();
  const [choice, setChoice] = useState('last12');
  const [today] = useState(() => new Date());
  const years = useQuery(yearsQuery(api));
  const first = years.data?.at(-1) ?? today.getFullYear();
  const period = useMemo(() => periodOf(choice, today, first), [choice, today, first]);
  const range = { from: period.from, to: period.to };
  const engine = useQuery({
    ...engineQuery(api),
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });
  const year = /^\d{4}/.test(choice) ? choice.slice(0, 4) : null;
  const months = useMemo(() => {
    if (!year) return [];
    const y = Number(year);
    const last = y === today.getFullYear() ? today.getMonth() : 11;
    return Array.from({ length: last + 1 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
  }, [year, today]);

  return (
    <Screen>
      <Title>{t('nav.stats')}</Title>
      <Choice
        scroll
        label={t('stats.period')}
        value={year ?? choice}
        onChange={setChoice}
        options={[
          { value: 'last12', label: t('stats.period.last12') },
          { value: 'all', label: t('stats.period.all') },
          ...(years.data ?? []).map((y) => ({ value: String(y), label: String(y) })),
        ]}
      />
      {months.length > 0 && year && (
        <Choice
          scroll
          label={t('search.date')}
          value={choice}
          onChange={setChoice}
          options={[
            { value: year, label: '—' },
            ...months.map((m) => ({
              value: m,
              label: new Date(`${m}-15T12:00:00`).toLocaleDateString(locale, { month: 'short' }),
            })),
          ]}
        />
      )}
      {engine.data?.running && (
        <Muted accessibilityRole="alert">
          {t('stats.recomputing', { done: engine.data.done, total: engine.data.total })}
        </Muted>
      )}

      <Now />

      <Summary range={range} />
      <Fitness range={range} />
      <Volume range={range} unit={period.unit} />
      <Curves range={range} />
      <Records range={range} />
      <Progress selected={Number(year) || today.getFullYear()} />
      <Efficiency range={range} />
      <CompareWithStrava />

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
