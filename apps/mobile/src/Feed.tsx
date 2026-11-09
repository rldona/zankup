/**
 * The feed (OS-504): "This week" on top, then every activity, newest first, with its figures and a
 * thumbnail of the route. Pull to refresh; it keeps loading as you scroll, and works offline with what
 * was seen (OS-505).
 */
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { FlashList } from '@shopify/flash-list';
import {
  activitiesQuery,
  decodePolyline,
  formatActivityDate,
  formatDuration,
  formatHoursMinutes,
  localStart,
  usesPace,
  weekQuery,
  type ActivitySummary,
  SPORT_ICONS,
} from '@zankup/core';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { memo, useMemo } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useApi } from './auth';
import { locale, t } from './i18n';
import { Icon, SportIcon } from './Icon';
import { asSport, useFormat } from './prefs';
import { useTheme } from './theme';
import { Card, Empty, Muted, Stat, styles as ui } from './ui';

type Format = ReturnType<typeof useFormat>;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function Feed() {
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const feed = useInfiniteQuery(activitiesQuery(api));
  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);
  return (
    <FlashList
      data={items}
      keyExtractor={(a) => String(a.id)}
      renderItem={({ item }) => <ActivityCard activity={item} format={format} />}
      ListHeaderComponent={<WeekHeader format={format} />}
      ListEmptyComponent={feed.isFetched ? <Empty>{t('feed.empty')}</Empty> : null}
      onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && void feed.fetchNextPage()}
      onEndReachedThreshold={0.5}
      refreshControl={
        <RefreshControl
          refreshing={feed.isRefetching}
          onRefresh={() => void feed.refetch()}
          tintColor={c.accent}
        />
      }
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
    />
  );
}

function WeekHeader({ format }: { format: Format }) {
  const api = useApi();
  const c = useTheme();
  const day = today();
  const week = useQuery(weekQuery(api, day));
  if (!week.data) return <View style={{ height: 8 }} />;
  const { days, this_week: totals, streak_weeks: streak } = week.data;
  return (
    <Card style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={[ui.heading, { color: c.fg, marginTop: 0 }]}>{t('week.title')}</Text>
        <Muted>{t('week.streak', { count: streak })}</Muted>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {days.map((d) => {
          const first = d.activities[0];
          const date = new Date(`${d.date}T12:00:00`);
          const label = date.toLocaleDateString(locale, { weekday: 'narrow' });
          const sport = first ? asSport(first.sport) : null;
          return (
            <Pressable
              key={d.date}
              disabled={!first}
              onPress={() => first && router.push(`/activity/${first.id}`)}
              accessibilityRole={first ? 'button' : 'text'}
              accessibilityLabel={date.toLocaleDateString(locale, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
              style={{ alignItems: 'center', gap: 4, opacity: d.date > day ? 0.4 : 1 }}
            >
              <View
                style={[
                  feedStyles.dot,
                  {
                    borderColor: d.date === day ? c.accent : sport ? c[sport] : c.line,
                    backgroundColor: sport ? c[sport] : 'transparent',
                  },
                ]}
              >
                {sport ? (
                  <Icon name={SPORT_ICONS[sport]} color="#fff" size={18} />
                ) : (
                  <Text
                    style={{ color: d.date === day ? c.accent : c.muted, fontSize: 12, fontWeight: '600' }}
                  >
                    {date.getDate()}
                  </Text>
                )}
              </View>
              <Text style={{ color: d.date === day ? c.accent : c.muted, fontSize: 11 }}>
                {d.date === day ? t('week.today') : label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={ui.stats}>
        <Stat label={t('feed.title')} value={String(totals.count)} />
        <Stat label={t('feed.stat.distance')} value={format.distance(totals.distance_m)} />
        <Stat label={t('feed.stat.time')} value={formatHoursMinutes(totals.moving_s)} />
        <Stat label={t('feed.stat.ascent')} value={format.elevation(totals.ascent_m)} />
      </View>
    </Card>
  );
}

export const ActivityCard = memo(function ActivityCard({
  activity: a,
  format,
}: {
  activity: ActivitySummary;
  format: Format;
}) {
  const c = useTheme();
  const sport = asSport(a.sport);
  const moving = a.moving_s ?? a.duration_s;
  const figures: [string, string][] = a.distance_m
    ? [
        [t('feed.stat.distance'), format.distance(a.distance_m)],
        [t('feed.stat.time'), formatDuration(moving)],
        [
          t(usesPace(sport) ? 'feed.stat.pace' : 'feed.stat.speed'),
          format.speedFor(moving > 0 ? a.distance_m / moving : 0, usesPace(sport)),
        ],
      ]
    : [
        [t('feed.stat.time'), formatDuration(moving)],
        ...(a.avg_hr ? ([[t('feed.stat.hr'), `${a.avg_hr} bpm`]] as [string, string][]) : []),
      ];
  return (
    <Pressable
      onPress={() => router.push(`/activity/${a.id}`)}
      accessibilityRole="button"
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Card>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <SportIcon sport={sport} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: c.fg, fontWeight: '700', fontSize: 16 }}>
              {a.name ?? t(`sport.${sport}`)}
            </Text>
            <Muted>{formatActivityDate(localStart(a.start_utc, a.timezone), locale)}</Muted>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <View style={[ui.stats, { flex: 1, justifyContent: 'flex-start', gap: 16 }]}>
            {figures.map(([label, value]) => (
              <Stat key={label} label={label} value={value} />
            ))}
          </View>
          {a.route ? <Thumbnail route={a.route} colour={c[sport]} /> : null}
        </View>
      </Card>
    </Pressable>
  );
});

function Thumbnail({ route, colour }: { route: string; colour: string }) {
  const path = useMemo(() => {
    const points = decodePolyline(route);
    if (points.length < 2) return null;
    const lat0 = points.reduce((s, p) => s + p[0], 0) / points.length;
    const k = Math.cos((lat0 * Math.PI) / 180);
    const xs = points.map((p) => p[1] * k);
    const ys = points.map((p) => p[0]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const scale = Math.min(76 / (maxX - minX || 1e-9), 52 / (maxY - minY || 1e-9));
    const offX = 6 + (76 - (maxX - minX) * scale) / 2;
    const offY = 6 + (52 - (maxY - minY) * scale) / 2;
    const p = Skia.PathBuilder.Make();
    points.forEach((pt, i) => {
      const x = offX + (pt[1] * k - minX) * scale;
      const y = offY + (maxY - pt[0]) * scale;
      if (i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    });
    return p.build();
  }, [route]);
  if (!path) return null;
  return (
    <Canvas style={{ width: 88, height: 64 }}>
      <Path path={path} style="stroke" strokeWidth={2} strokeJoin="round" strokeCap="round" color={colour} />
    </Canvas>
  );
}

const feedStyles = StyleSheet.create({
  dot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
