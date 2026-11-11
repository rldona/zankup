/**
 * Routes done more than once, on the phone (OS-520), as in the PWA (OS-309). The screen slides in at
 * once with a skeleton; the list comes once it has settled, and only the routes in sight are drawn,
 * so a long history doesn't hold the tap up.
 */
import { formatDuration, routesQuery, routeThumbnail } from '@zankup/core';
import { Canvas, Path } from '@shopify/react-native-skia';
import { useQuery } from '@tanstack/react-query';
import { router, useNavigation } from 'expo-router';
import { memo, useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { useApi } from '../../src/auth';
import { t } from '../../src/i18n';
import { asSport, useFormat } from '../../src/prefs';
import { RoutesSkeleton } from '../../src/Skeleton';
import { sportColour } from '../../src/stats/Sections';
import { useTheme } from '../../src/theme';
import { Card, Muted, Screen, styles as ui } from '../../src/ui';

type Route = NonNullable<ReturnType<typeof useRoutes>['data']>[number];

const useRoutes = () => useQuery(routesQuery(useApi()));

export default function RoutesScreen() {
  const routes = useRoutes();
  // The list waits for the screen to finish sliding in, so the tap answers at once.
  const navigation = useNavigation();
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const settle = () => setSettled(true);
    const off = navigation.addListener('transitionEnd' as never, settle);
    const fallback = setTimeout(settle, 450);
    return () => {
      off();
      clearTimeout(fallback);
    };
  }, [navigation]);
  const ready = settled && routes.data;
  return (
    <Screen header scroll={false}>
      {!ready ? (
        <View style={ui.page}>
          <RoutesSkeleton />
        </View>
      ) : routes.data.length === 0 ? (
        <View style={ui.page}>
          <Muted>{t('routes.empty')}</Muted>
        </View>
      ) : (
        <FlatList
          data={routes.data}
          keyExtractor={(r) => String(r.id)}
          renderItem={({ item }) => <RouteRow route={item} />}
          contentContainerStyle={ui.page}
          initialNumToRender={8}
          windowSize={7}
        />
      )}
    </Screen>
  );
}

const RouteRow = memo(function RouteRow({ route: r }: { route: Route }) {
  const c = useTheme();
  const format = useFormat();
  const shape = routeThumbnail(r.route);
  return (
    <Pressable accessibilityRole="link" onPress={() => router.push(`/routes/${r.id}`)}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: c.fg, fontWeight: '700' }}>{r.name ?? t(`sport.${asSport(r.sport)}`)}</Text>
          <Muted>
            {t('routes.times', { count: r.count })} ·{' '}
            {r.best.distance_m ? format.distance(r.best.distance_m) : ''} · {t('routes.best')}{' '}
            {formatDuration(r.best.moving_s)}
          </Muted>
        </View>
        {shape && (
          <Canvas style={{ width: 88, height: 64 }}>
            <Path
              path={`M${shape.replace(/ /g, 'L')}`}
              style="stroke"
              strokeWidth={2}
              strokeJoin="round"
              color={sportColour(c, r.sport)}
            />
          </Canvas>
        )}
      </Card>
    </Pressable>
  );
});
