/**
 * Home (OS-527): ZANKUP, with the Coach and notifications on the right, over this week, the last day with
 * activities, the last seven days and the metrics. The header stays put while the widgets scroll.
 */
import { aiStatusQuery, type MessageKey } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { WeekHeader } from '../../src/Feed';
import { LastDay, LastSevenDays, Metrics } from '../../src/home/Widgets';
import { useApi } from '../../src/auth';
import { Icon, type IconName } from '../../src/Icon';
import { t } from '../../src/i18n';
import { useFormat } from '../../src/prefs';
import { useTheme } from '../../src/theme';
import { styles as ui, useTopInset } from '../../src/ui';
import { Wordmark } from '../../src/Wordmark';

const ACTIONS: { href: string; icon: IconName; label: MessageKey }[] = [
  { href: '/coach', icon: 'wand_stars', label: 'nav.coach' },
  { href: '/notifications', icon: 'notifications', label: 'home.notifications' },
];

export default function HomeScreen() {
  const c = useTheme();
  const api = useApi();
  const ai = useQuery({ ...aiStatusQuery(api), retry: false });
  const format = useFormat();
  const top = useTopInset();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: top }}>
      <View style={ui.headerBar}>
        <View style={{ flex: 1 }}>
          <Wordmark height={15} />
        </View>
        {ACTIONS.filter((a) => a.href !== '/coach' || ai.data?.available).map((a) => (
          <Pressable
            key={a.href}
            accessibilityRole="button"
            accessibilityLabel={t(a.label)}
            hitSlop={10}
            onPress={() => router.push(a.href as never)}
          >
            <Icon name={a.icon} color={c.fg} size={24} />
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={[ui.page, { paddingTop: 4 }]}>
        <WeekHeader format={format} />
        <LastDay />
        <LastSevenDays />
        <Metrics />
      </ScrollView>
    </View>
  );
}
