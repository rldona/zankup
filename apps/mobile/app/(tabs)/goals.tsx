/** Goals (OS-527): each goal with its progress and end-of-period projection, and adding new ones. */
import { Goals } from '../../src/profile/Sections';
import { t } from '../../src/i18n';
import { Screen } from '../../src/ui';

export default function GoalsScreen() {
  return (
    <Screen title={t('nav.goals')}>
      <Goals />
    </Screen>
  );
}
