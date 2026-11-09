/**
 * Home (OS-527): ZANKUP, with sync and notifications on the right, over this week, the last day with
 * activities, the last seven days and the metrics. The header stays put while the widgets scroll.
 */
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WeekHeader } from '../../src/Feed';
import { LastDay, LastSevenDays, Metrics } from '../../src/home/Widgets';
import { Icon } from '../../src/Icon';
import { t } from '../../src/i18n';
import { useFormat } from '../../src/prefs';
import { useTheme } from '../../src/theme';
import { styles as ui } from '../../src/ui';
import { Wordmark } from '../../src/Wordmark';

export default function HomeScreen() {
  const c = useTheme();
  const format = useFormat();
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 12,
          gap: 22,
        }}
      >
        <View style={{ flex: 1 }}>
          <Wordmark height={15} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('home.sync')}
          hitSlop={10}
          onPress={() => router.push('/sync')}
        >
          <Icon name="sync" color={c.fg} size={26} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('home.notifications')}
          hitSlop={10}
          onPress={() => router.push('/notifications')}
        >
          <Icon name="notifications" color={c.fg} size={26} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={[ui.page, { paddingTop: 4 }]}>
        <WeekHeader format={format} />
        <LastDay />
        <LastSevenDays />
        <Metrics />
      </ScrollView>
    </SafeAreaView>
  );
}
