/** Progress's Fitness card: today's score, its change over the last month and the month's line. */
import { fitnessQuery } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useApi } from '../auth';
import { Icon } from '../Icon';
import { t } from '../i18n';
import { CardSkeleton } from '../Skeleton';
import { useTheme } from '../theme';
import { accent, Card, Muted } from '../ui';
import { fitnessChange, rangePeriod, untilToday } from './fitness';
import { FitnessSparkline } from './FitnessChart';

export function FitnessCard() {
  const api = useApi();
  const c = useTheme();
  const fitness = useQuery(fitnessQuery(api, rangePeriod('1m', new Date())));
  if (fitness.isPending) return <CardSkeleton lines={3} />;
  const values = untilToday(fitness.data ?? [], new Date()).map((d) => d.ctl);
  const now = values.at(-1);
  const change = now != null ? fitnessChange(values[0], now) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('progress.fitness')}, ${t('progress.score')} ${now != null ? Math.round(now) : '–'}`}
      onPress={() => router.push('/fitness')}
    >
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name="monitoring" color={accent(c)} size={26} />
          <Text style={{ flex: 1, color: c.fg, fontSize: 16, fontWeight: '700' }}>
            {t('progress.fitness')}
          </Text>
          <Muted style={{ fontSize: 14 }}>{t('progress.lastMonth')}</Muted>
          <Icon name="chevron_right" color={c.muted} size={22} />
        </View>
        {now == null || !change ? (
          <Muted style={{ marginTop: 12 }}>{t('progress.noFitness')}</Muted>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 8 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: c.fg, fontSize: 14 }}>{t('progress.score')}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ color: c.fg, fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                  {Math.round(now)}
                </Text>
                {change.direction !== 'none' && (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: 6,
                      backgroundColor: c.surface2,
                    }}
                  >
                    <Text
                      style={{ color: change.direction === 'up' ? c.formPositive : c.muted, fontSize: 11 }}
                    >
                      {change.direction === 'up' ? '▲' : '▼'}
                    </Text>
                    <Text style={{ color: c.fg, fontSize: 14, fontVariant: ['tabular-nums'] }}>
                      {Math.abs(change.points)}
                    </Text>
                  </View>
                )}
              </View>
            </View>
            {values.length > 1 && <FitnessSparkline values={values} />}
          </View>
        )}
      </Card>
    </Pressable>
  );
}
