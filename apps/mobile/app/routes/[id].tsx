/** One route and every time you did it, fastest marked (OS-520, OS-309). */
import { formatDuration, routeQuery } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useApi } from '../../src/auth';
import { shortDay } from '../../src/estimates';
import { t } from '../../src/i18n';
import { asSport, useFormat } from '../../src/prefs';
import { sportColour } from '../../src/stats/Sections';
import { useTheme } from '../../src/theme';
import { TrackMap } from '../../src/TrackMap';
import { Card, Loading, Muted, Screen } from '../../src/ui';

export default function RouteScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const route = useQuery({ ...routeQuery(api, id), enabled: Number.isInteger(id) });
  if (!route.data) return <Loading />;
  const r = route.data;
  const fastest = Math.min(...r.activities.map((a) => a.moving_s));
  return (
    <Screen header>
      <Stack.Screen options={{ title: r.name ?? t(`sport.${asSport(r.sport)}`) }} />
      <Muted>{t('routes.times', { count: r.count })}</Muted>
      {r.route && <TrackMap tracks={[r.route]} colour={sportColour(c, r.sport)} />}
      <Card>
        {[...r.activities].reverse().map((a) => (
          <Pressable
            key={a.id}
            accessibilityRole="link"
            onPress={() => router.push(`/activity/${a.id}`)}
            style={{ flexDirection: 'row', paddingVertical: 6, gap: 8 }}
          >
            <Text style={{ flex: 1.3, color: c.accent, fontWeight: '600' }}>{shortDay(a.day)}</Text>
            <Text style={{ flex: 1, color: c.fg, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
              {formatDuration(a.moving_s)}
            </Text>
            <Text style={{ flex: 1, color: c.fg, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
              {a.distance_m ? format.speedFor(a.distance_m / a.moving_s, asSport(r.sport) !== 'ride') : '—'}
            </Text>
            <View style={{ flex: 0.9, alignItems: 'flex-end' }}>
              <Text style={{ color: c.muted, fontVariant: ['tabular-nums'] }}>
                {a.moving_s === fastest ? '🏆' : `+${formatDuration(a.moving_s - fastest)}`}
              </Text>
            </View>
          </Pressable>
        ))}
      </Card>
    </Screen>
  );
}
