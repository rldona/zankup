/**
 * Progress: how your training is going, as Strava's: this week and the last 12 (volume) first, then
 * Series (the weekly streak) beside the Training log, then Fitness, Relative Effort, race predictions and goals.
 */
import { View } from 'react-native';

import { t } from '../../src/i18n';
import { EffortCard } from '../../src/progress/EffortCard';
import { FitnessCard } from '../../src/progress/FitnessCard';
import { GoalsCard } from '../../src/progress/GoalsCard';
import { PredictionsCard } from '../../src/progress/Predictions';
import { LogCard } from '../../src/progress/Log';
import { SeriesCard } from '../../src/progress/Series';
import { VolumeCard } from '../../src/progress/VolumeCard';
import { Screen } from '../../src/ui';

export default function ProgressScreen() {
  return (
    <Screen title={t('nav.progress')}>
      <VolumeCard />
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'stretch' }}>
        <SeriesCard />
        <LogCard />
      </View>
      <FitnessCard />
      <EffortCard />
      <PredictionsCard />
      <GoalsCard />
    </Screen>
  );
}
