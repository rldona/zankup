/**
 * Progress: how your training is going, as Strava's: Fitness, then Series (the weekly streak) beside the
 * Training log.
 */
import { View } from 'react-native';

import { t } from '../../src/i18n';
import { FitnessCard } from '../../src/progress/FitnessCard';
import { LogCard } from '../../src/progress/Log';
import { SeriesCard } from '../../src/progress/Series';
import { Screen } from '../../src/ui';

export default function ProgressScreen() {
  return (
    <Screen title={t('nav.progress')}>
      <FitnessCard />
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'stretch' }}>
        <SeriesCard />
        <LogCard />
      </View>
    </Screen>
  );
}
