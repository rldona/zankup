/** Routes done more than once, on the phone (OS-520), as in the PWA (OS-309). */
import { formatDuration, routesQuery, routeThumbnail } from '@zankup/core';
import { Canvas, Path } from '@shopify/react-native-skia';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useApi } from '../../src/auth';
import { t } from '../../src/i18n';
import { asSport, useFormat } from '../../src/prefs';
import { sportColour } from '../../src/stats/Sections';
import { useTheme } from '../../src/theme';
import { Card, Muted, Screen } from '../../src/ui';

export default function RoutesScreen() {
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const routes = useQuery(routesQuery(api));
  return (
    <Screen header>
      {routes.data?.length === 0 && <Muted>{t('routes.empty')}</Muted>}
      {routes.data?.map((r) => {
        const shape = routeThumbnail(r.route);
        return (
          <Pressable key={r.id} accessibilityRole="link" onPress={() => router.push(`/routes/${r.id}`)}>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: c.fg, fontWeight: '700' }}>
                  {r.name ?? t(`sport.${asSport(r.sport)}`)}
                </Text>
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
      })}
    </Screen>
  );
}
