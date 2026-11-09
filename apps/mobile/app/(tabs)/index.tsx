import { View } from 'react-native';

import { Feed } from '../../src/Feed';
import { t } from '../../src/i18n';
import { Screen, Title } from '../../src/ui';

/** Activities: the title stays put while the week and the feed scroll under it. */
export default function FeedScreen() {
  return (
    <Screen scroll={false}>
      <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 }}>
        <Title>{t('nav.feed')}</Title>
      </View>
      <Feed />
    </Screen>
  );
}
