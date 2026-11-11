/**
 * The personal heatmap on the phone (OS-520), as in the PWA (OS-310): every route with GPS, on a map
 * that fills the screen. A see-through header (back on a round background, the title on the map itself) and the sport chips sit over the
 * map, and the number of routes at the bottom.
 */
import { heatmapQuery } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApi } from '../src/auth';
import { Icon } from '../src/Icon';
import { t } from '../src/i18n';
import { useTheme } from '../src/theme';
import { TrackMap } from '../src/TrackMap';
import { Choice, Loading, Muted } from '../src/ui';

/** The header's height under the status bar, and the chips' row under it. */
const HEADER = 56;
const CHIPS = 60;

export default function HeatmapScreen() {
  const api = useApi();
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const [sport, setSport] = useState('');
  const routes = useQuery(heatmapQuery(api, {}, sport ? [sport] : undefined));
  const count = routes.data?.routes.length ?? 0;
  const pill = {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 999,
  } as const;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ headerShown: false, title: t('heatmap.title') }} />
      {routes.isPending ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Loading />
        </View>
      ) : count > 0 ? (
        <TrackMap
          key={sport}
          tracks={routes.data?.routes ?? []}
          colour={c.run}
          heat
          fill
          padding={{
            top: insets.top + HEADER + CHIPS + 16,
            right: 24,
            bottom: insets.bottom + 64,
            left: 24,
          }}
        />
      ) : (
        <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
          <Muted>{t('heatmap.note')}</Muted>
        </View>
      )}

      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', top: insets.top, left: 0, right: 0, paddingHorizontal: 12 }}
      >
        <View style={{ height: HEADER, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            hitSlop={6}
            onPress={() => router.back()}
            style={[pill, { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }]}
          >
            <Icon name="arrow_back" color={c.fg} />
          </Pressable>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={{
              flex: 1,
              color: c.fg,
              fontSize: 18,
              fontWeight: '600',
              textShadowColor: c.bg,
              textShadowRadius: 6,
            }}
          >
            {t('heatmap.title')}
          </Text>
        </View>
        <View style={{ alignItems: 'center', marginTop: 12 }}>
          <Choice
            label={t('feed.sports')}
            value={sport}
            onChange={setSport}
            options={[
              { value: '', label: t('feed.all') },
              ...(['run', 'ride', 'walk'] as const).map((s) => ({ value: s, label: t(`sport.${s}`) })),
            ]}
          />
        </View>
      </View>

      {count > 0 && (
        <View
          pointerEvents="none"
          accessibilityLabel={`${t('heatmap.note')} ${t('heatmap.count', { count })}`}
          style={[
            pill,
            {
              position: 'absolute',
              bottom: insets.bottom + 12,
              alignSelf: 'center',
              paddingHorizontal: 14,
              paddingVertical: 8,
            },
          ]}
        >
          <Text style={{ color: c.fg, fontWeight: '600' }}>{t('heatmap.count', { count })}</Text>
        </View>
      )}
    </View>
  );
}
