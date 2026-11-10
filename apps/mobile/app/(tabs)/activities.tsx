import { router } from 'expo-router';
import { Pressable } from 'react-native';

import { Feed } from '../../src/Feed';
import { Icon } from '../../src/Icon';
import { t } from '../../src/i18n';
import { useTheme } from '../../src/theme';
import { Screen } from '../../src/ui';

/** Activities: the title stays put while the feed scrolls under it; sync and the calendar are on its right. */
export default function ActivitiesScreen() {
  const c = useTheme();
  return (
    <Screen
      scroll={false}
      title={t('nav.feed')}
      actions={
        <>
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
            accessibilityLabel={t('stats.calendar')}
            hitSlop={10}
            onPress={() => router.push('/calendar')}
          >
            <Icon name="calendar_month" color={c.fg} size={26} />
          </Pressable>
        </>
      }
    >
      <Feed />
    </Screen>
  );
}
