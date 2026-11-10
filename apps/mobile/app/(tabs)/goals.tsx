/**
 * Goals (OS-527): each goal with its progress and end-of-period projection; the + in the header opens
 * the form to add one.
 */
import { goalsQuery } from '@zankup/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable } from 'react-native';

import { useApi } from '../../src/auth';
import { Icon } from '../../src/Icon';
import { t } from '../../src/i18n';
import { useFormat } from '../../src/prefs';
import { GoalForm, Goals } from '../../src/profile/Sections';
import { useTheme } from '../../src/theme';
import { Screen } from '../../src/ui';

export default function GoalsScreen() {
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  return (
    <Screen
      title={t('nav.goals')}
      actions={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('goals.add')}
          hitSlop={10}
          onPress={() => setAdding(true)}
        >
          <Icon name="add" color={c.fg} size={28} />
        </Pressable>
      }
    >
      <Goals withForm={false} />
      {adding && (
        <GoalForm
          bare
          unit={format.unit}
          onCancel={() => setAdding(false)}
          onDone={() => {
            void queryClient.invalidateQueries({ queryKey: goalsQuery(api).queryKey });
            setAdding(false);
          }}
        />
      )}
    </Screen>
  );
}
