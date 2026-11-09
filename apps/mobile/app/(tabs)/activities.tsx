import { Feed } from '../../src/Feed';
import { t } from '../../src/i18n';
import { Screen } from '../../src/ui';

/** Activities: the title stays put while the week and the feed scroll under it. */
export default function FeedScreen() {
  return (
    <Screen scroll={false} title={t('nav.feed')}>
      <Feed />
    </Screen>
  );
}
