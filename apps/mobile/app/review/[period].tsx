/**
 * A month or a year in review on the phone (OS-521), as in the PWA (OS-413): totals against the
 * previous period with their bars, consistency and sports, the longest, hardest and hilliest
 * activity, records and gear; moving between months and years.
 */
import { formatDuration, reviewQuery, type Review, effortShown } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useApi } from '../../src/auth';
import { effortName } from '../../src/estimates';
import { locale, t } from '../../src/i18n';
import { asSport, useFormat } from '../../src/prefs';
import { change, shiftPeriod } from '../../src/stats/dates';
import { useTheme } from '../../src/theme';
import { Button, Card, Choice, Heading, Loading, Muted, Screen, Stat, styles as ui } from '../../src/ui';

type Format = ReturnType<typeof useFormat>;

function title(period: 'month' | 'year', value: string): string {
  if (period === 'year') return value;
  const [y, m] = value.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, 15)).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export default function ReviewScreen() {
  const api = useApi();
  const format = useFormat();
  const params = useLocalSearchParams<{ period: string; value?: string }>();
  const now = new Date();
  const [period, setPeriod] = useState<'month' | 'year'>(params.period === 'year' ? 'year' : 'month');
  const [value, setValue] = useState(
    params.value ??
      (period === 'year'
        ? String(now.getFullYear())
        : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`),
  );
  const review = useQuery(reviewQuery(api, period, value));
  const heading = title(period, value);
  const switchTo = (next: 'month' | 'year') => {
    setPeriod(next);
    setValue(next === 'year' ? value.slice(0, 4) : value.length === 4 ? `${value}-12` : value);
  };
  return (
    <Screen
      header
      toolbar={
        <Choice
          center
          label={t('review.period')}
          value={period}
          onChange={switchTo}
          options={[
            { value: 'month', label: t('review.month') },
            { value: 'year', label: t('review.year') },
          ]}
        />
      }
    >
      <Stack.Screen
        options={{
          title: t(period === 'year' ? 'review.yearTitle' : 'review.monthTitle', { period: heading }),
        }}
      />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button
            onPress={() => setValue(shiftPeriod(period, value, -1))}
          >{`← ${title(period, shiftPeriod(period, value, -1))}`}</Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button
            onPress={() => setValue(shiftPeriod(period, value, 1))}
          >{`${title(period, shiftPeriod(period, value, 1))} →`}</Button>
        </View>
      </View>
      {review.isPending && <Loading />}
      {review.isError && !review.data && <Muted accessibilityRole="alert">{t('common.error')}</Muted>}
      {review.data && review.data.totals.count === 0 && <Muted>{t('review.empty')}</Muted>}
      {review.data && review.data.totals.count > 0 && <Cards data={review.data} format={format} />}
    </Screen>
  );
}

function Cards({ data, format }: { data: Review; format: Format }) {
  const c = useTheme();
  const sports = Object.entries(data.by_sport).sort((a, b) => b[1].moving_s - a[1].moving_s);
  const totals: [string, string, number, number][] = [
    [t('review.activities'), String(data.totals.count), data.totals.count, data.previous.count],
    [
      t('feed.stat.distance'),
      format.distance(data.totals.distance_m),
      data.totals.distance_m,
      data.previous.distance_m,
    ],
    [t('feed.stat.time'), formatDuration(data.totals.moving_s), data.totals.moving_s, data.previous.moving_s],
    [
      t('feed.stat.ascent'),
      format.elevation(data.totals.ascent_m),
      data.totals.ascent_m,
      data.previous.ascent_m,
    ],
  ];
  const max = Math.max(...data.buckets.map((b) => b.distance_m), 1);
  const open = (id: number) => router.push(`/activity/${id}`);
  return (
    <>
      <Card>
        <Heading>{t('review.totals')}</Heading>
        <View style={ui.stats}>
          {totals.map(([label, value, now, before]) => {
            const delta = change(now, before);
            return (
              <View key={label} style={{ minWidth: 120 }}>
                <Stat label={label} value={value} />
                {delta && <Muted style={{ fontSize: 11 }}>{t('review.vsPrevious', { change: delta })}</Muted>}
              </View>
            );
          })}
        </View>
        <View
          accessible
          accessibilityLabel={t('review.barsLabel')}
          style={{ flexDirection: 'row', alignItems: 'flex-end', height: 72, gap: 2 }}
        >
          {data.buckets.map((b) => (
            <View
              key={b.start}
              style={{
                flex: 1,
                height: `${Math.max(b.count ? 4 : 0, (b.distance_m / max) * 100)}%`,
                backgroundColor: c.accent,
                borderRadius: 2,
              }}
            />
          ))}
        </View>
      </Card>
      <Card>
        <Heading>{t('review.consistency')}</Heading>
        <View style={ui.stats}>
          <Stat label={t('review.activeDays')} value={String(data.active_days)} />
          <Stat label={t('review.streak')} value={String(data.longest_streak)} />
        </View>
        {sports.map(([sport, s]) => (
          <View key={sport} style={{ paddingVertical: 3 }}>
            <Text style={{ color: c.fg, fontWeight: '600' }}>{t(`sport.${asSport(sport)}`)}</Text>
            <Muted>
              {t('review.activitiesCount', { count: s.count })}
              {s.distance_m ? ` · ${format.distance(s.distance_m)}` : ''} · {formatDuration(s.moving_s)}
            </Muted>
          </View>
        ))}
      </Card>
      {(['longest', 'hardest', 'hilliest'] as const).map((key) => {
        const a = data[key];
        if (!a) return null;
        return (
          <Pressable key={key} accessibilityRole="link" onPress={() => open(a.id)}>
            <Card>
              <Heading>{t(`review.${key}`)}</Heading>
              <Text style={{ color: c.accent, fontWeight: '700' }}>
                {a.name ?? t(`sport.${asSport(a.sport)}`)}
                <Text style={{ color: c.muted, fontWeight: '400' }}>
                  {' · '}
                  {new Date(`${a.day}T12:00:00`).toLocaleDateString(locale, {
                    day: 'numeric',
                    month: 'short',
                  })}
                </Text>
              </Text>
              <View style={ui.stats}>
                {a.distance_m ? (
                  <Stat label={t('feed.stat.distance')} value={format.distance(a.distance_m)} />
                ) : null}
                <Stat label={t('feed.stat.time')} value={formatDuration(a.moving_s)} />
                {a.ascent_m ? (
                  <Stat label={t('feed.stat.ascent')} value={format.elevation(a.ascent_m)} />
                ) : null}
                {a.load ? <Stat label={t('activity.effort')} value={String(Math.round(a.load))} /> : null}
              </View>
            </Card>
          </Pressable>
        );
      })}
      {data.records.length > 0 && (
        <Card>
          <Heading>{t('review.records')}</Heading>
          {data.records
            .filter((r) => effortShown(r.distance_key, format.unit))
            .map((r) => (
              <Pressable
                key={r.distance_key}
                accessibilityRole="link"
                onPress={() => open(r.activity_id)}
                style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}
              >
                <Text style={{ color: c.accent, fontWeight: '600' }}>
                  {effortName(r.distance_key)}
                  {r.previous_s ? (
                    <Text style={{ color: c.muted, fontWeight: '400' }}>
                      {' '}
                      {t('review.beat', { previous: formatDuration(r.previous_s) })}
                    </Text>
                  ) : null}
                </Text>
                <Text style={{ color: c.fg, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                  {formatDuration(r.time_s)}
                </Text>
              </Pressable>
            ))}
        </Card>
      )}
      {data.gear.length > 0 && (
        <Card>
          <Heading>{t('review.gear')}</Heading>
          {data.gear.map((g) => (
            <View
              key={g.id}
              style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.fg, fontWeight: '600' }}>{g.name}</Text>
                <Muted>{t('review.activitiesCount', { count: g.count })}</Muted>
              </View>
              <Text style={{ color: c.fg, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                {format.distance(g.distance_m)}
              </Text>
            </View>
          ))}
        </Card>
      )}
    </>
  );
}
