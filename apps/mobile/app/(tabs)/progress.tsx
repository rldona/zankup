/**
 * Progress: how your training is going, as Strava's: this week and the last 12 (volume) first, then
 * Series (the weekly streak) beside the Training log, then Fitness, Relative Effort, race predictions and goals.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { t } from '../../src/i18n';
import { EffortCard } from '../../src/progress/EffortCard';
import { FitnessCard } from '../../src/progress/FitnessCard';
import { GoalsCard } from '../../src/progress/GoalsCard';
import { PredictionsCard } from '../../src/progress/Predictions';
import { LogCard } from '../../src/progress/Log';
import { SeriesCard, SeriesPanel } from '../../src/progress/Series';
import { VolumeCard } from '../../src/progress/VolumeCard';
import { Screen } from '../../src/ui';

export default function ProgressScreen() {
  const [series, setSeries] = useState(false);
  return (
    <Screen title={t('nav.progress')}>
      <VolumeCard />
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'stretch' }}>
        <SeriesCard onOpen={() => setSeries(true)} />
        <LogCard />
      </View>
      <FitnessCard />
      <EffortCard />
      <PredictionsCard />
      <GoalsCard />
      <SeriesPanel open={series} onClose={() => setSeries(false)} />
    </Screen>
  );
}
