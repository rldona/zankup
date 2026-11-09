import { Feed } from '../../src/Feed';
import { Screen } from '../../src/ui';

export default function FeedScreen() {
  return (
    <Screen scroll={false}>
      <Feed />
    </Screen>
  );
}
