/**
 * Best times on Progress (as Strava's): the card shows the last month's medals, up to three (of all
 * time first, then of their year), each opening its measure in app/bests.tsx. The medal, the measures'
 * names and the medal colours are shared by both.
 */
import { effortShown, recentBestsQuery, SPORT_ICONS } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useApi } from '../auth';
import { Icon } from '../Icon';
import { locale, t } from '../i18n';
import { useFormat, useUnits } from '../prefs';
import { CardSkeleton } from '../Skeleton';
import { useTheme } from '../theme';
import { accent, Card, Muted } from '../ui';
import { bestValue, RUN_KEYS } from './bests';
import { durationLabel } from './skillLevels';

/**
 * Medals are gold, silver and bronze in every theme: their colour is what they say. Past the third,
 * the theme's grey.
 */
export const MEDAL_COLOURS = ['#e8b10e', '#8f9ea6', '#c06d3d'];

/** A measure's name: 5 km, ½ mile… Power: 30 s, Longest ride. */
export function bestName(key: string): string {
  if (key.startsWith('power_'))
    return t('progress.bestPower', { duration: durationLabel(Number(key.slice(6))) });
  if (key === 'longest') return t('progress.bestLongest');
  return t(`effort.${key}` as never);
}

export const sportOf = (key: string) => ((RUN_KEYS as readonly string[]).includes(key) ? 'run' : 'ride');

/** A medal with its place, as Strava's: the first is "PR". */
export function Medal({ rank, size = 40 }: { rank: number; size?: number }) {
  const c = useTheme();
  const colour = MEDAL_COLOURS[rank - 1] ?? String(c.muted);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="military_tech-fill" color={colour} size={size} />
      <Text
        style={{
          position: 'absolute',
          bottom: size * 0.12,
          color: c.bg,
          fontSize: size * (rank === 1 ? 0.2 : 0.26),
          fontWeight: '900',
        }}
      >
        {rank === 1 ? 'PR' : rank}
      </Text>
    </View>
  );
}

export function BestsCard() {
  const api = useApi();
  const c = useTheme();
  const unit = useFormat().unit;
  const imperial = useUnits() === 'imperial';
  const medals = useQuery(recentBestsQuery(api, 30));
  if (medals.isPending) return <CardSkeleton lines={3} />;
  const shown = (medals.data ?? []).filter((m) => effortShown(m.key, unit)).slice(0, 3);
  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/bests')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
      >
        <Icon name="trophy" color={accent(c)} size={26} />
        <Text numberOfLines={1} style={{ flex: 1, color: c.fg, fontSize: 16, fontWeight: '700' }}>
          {t('progress.bests')}
        </Text>
        <Icon name="chevron_right" color={c.muted} size={22} />
      </Pressable>
      {!shown.length ? (
        <Muted style={{ marginTop: 12 }}>{t('progress.noRecentBests')}</Muted>
      ) : (
        <View style={{ flexDirection: 'row', marginTop: 12 }}>
          {shown.map((m) => (
            <Pressable
              key={`${m.key}-${m.activity_id}`}
              accessibilityRole="button"
              accessibilityLabel={`${bestName(m.key)} ${bestValue(m.key, m.value, locale, imperial)}`}
              onPress={() => router.push(`/bests?key=${m.key}`)}
              style={{ flex: 1, alignItems: 'center', gap: 4 }}
            >
              <Medal rank={m.rank} size={44} />
              <Text numberOfLines={1} style={{ color: c.fg, fontSize: 13 }}>
                {bestName(m.key)}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon name={SPORT_ICONS[sportOf(m.key)]} color={c.fg} size={18} />
                <Text style={{ color: c.fg, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                  {bestValue(m.key, m.value, locale, imperial)}
                </Text>
              </View>
              <Muted style={{ fontSize: 13 }}>
                {t(m.scope === 'all' ? 'progress.allTimeBest' : 'progress.yearBest')}
              </Muted>
            </Pressable>
          ))}
        </View>
      )}
    </Card>
  );
}
