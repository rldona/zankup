import { router } from 'expo-router';
import { Pressable } from 'react-native';

import { Icon } from '../../src/Icon';
import { t } from '../../src/i18n';
import { ActivitiesSearch } from '../../src/Search';
import { useTheme } from '../../src/theme';
import { Screen } from '../../src/ui';

/**
 * Activities: the title stays put with sync and the calendar on its right; under it the search bar and
 * the sports, then the feed or what the search finds.
 */
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
      <ActivitiesSearch />
    </Screen>
  );
}
