/**
 * Performance predictions, from Progress (as Strava's): today, the four races with their pace and how
 * they changed in 30 days; over a month, three or six, one race with its line. The range is chosen at
 * the bottom.
 */
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '../src/Icon';
import { locale, t } from '../src/i18n';
import { useUnits } from '../src/prefs';
import { isoDay } from '../src/progress/fitness';
import { ChangeBadge, PredictionChart, RaceBadge, usePredictions } from '../src/progress/Predictions';
import {
  racePace,
  RACES,
  raceTime,
  series,
  timeTicks,
  valueOn,
  type RaceKind,
} from '../src/progress/raceTimes';
import { addDays } from '../src/progress/weeks';
import { PageSkeleton } from '../src/Skeleton';
import { useTheme } from '../src/theme';
import { accent, InfoButton, Muted, Screen } from '../src/ui';

type Range = 'today' | '1m' | '3m' | '6m';
const DAYS = { '1m': 30, '3m': 83, '6m': 166 } as const;
const at = (iso: string) => new Date(`${iso}T12:00:00`);

export default function PredictionsScreen() {
  const c = useTheme();
  const imperial = useUnits() === 'imperial';
  const { byKind, isPending } = usePredictions();
  const [range, setRange] = useState<Range>('today');
  const [race, setRace] = useState<RaceKind>('race_5k');
  const today = isoDay(new Date());
  const unit = imperial ? '/mi' : '/km';
  const metres = (k: RaceKind) => RACES.find((r) => r.kind === k)?.metres ?? 5000;
  const any = RACES.some((r) => (byKind.get(r.kind) ?? []).length);

  const body = (() => {
    if (isPending) return <PageSkeleton cards={2} />;
    if (!any) return <Muted>{t('progress.noPredictions')}</Muted>;
    if (range === 'today') {
      return (
        <>
          <Text style={{ color: c.fg, fontSize: 14, lineHeight: 22 }}>{t('progress.predictionsIntro')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 28, marginTop: 12 }}>
            {RACES.map((r) => {
              const history = byKind.get(r.kind) ?? [];
              const now = valueOn(history, today);
              const before = valueOn(history, addDays(today, -30));
              return (
                <Pressable
                  key={r.kind}
                  accessibilityRole="button"
                  onPress={() => {
                    setRace(r.kind);
                    setRange('1m');
                  }}
                  style={{ width: '50%', alignItems: 'center', gap: 4 }}
                >
                  <RaceBadge race={r.kind} size={60} />
                  {now != null ? (
                    <>
                      <Text
                        style={{
                          color: c.fg,
                          fontSize: 24,
                          fontWeight: '800',
                          fontVariant: ['tabular-nums'],
                        }}
                      >
                        {raceTime(now)}
                      </Text>
                      <Muted style={{ fontSize: 14 }}>
                        {racePace(now, r.metres, imperial)} {unit}
                      </Muted>
                      {before != null && <ChangeBadge seconds={now - before} />}
                    </>
                  ) : (
                    <Muted>–</Muted>
                  )}
                </Pressable>
              );
            })}
          </View>
        </>
      );
    }
    const from = addDays(today, -DAYS[range]);
    const history = byKind.get(race) ?? [];
    const points = series(history, from, today);
    const now = valueOn(history, today);
    const values = points.map((p) => p.value);
    const ticks = values.length ? timeTicks(Math.min(...values), Math.max(...values)) : [];
    // Under the chart: Mondays over a month, the first of each month over longer ranges.
    const labels: { day: string; text: string }[] = [];
    for (let day = addDays(from, 1); day < today; day = addDays(day, 1)) {
      const d = at(day);
      if (range === '1m' ? d.getDay() === 1 : d.getDate() === 1)
        labels.push({
          day,
          text: d
            .toLocaleDateString(
              locale,
              range === '1m' ? { day: 'numeric', month: 'short' } : { month: 'short' },
            )
            .replace('.', '')
            .toUpperCase(),
        });
    }
    return (
      <>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {RACES.map((r) => {
            const on = r.kind === race;
            return (
              <Pressable
                key={r.kind}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => setRace(r.kind)}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 9,
                  borderRadius: 999,
                  borderWidth: 1.5,
                  borderColor: on ? accent(c) : c.line,
                }}
              >
                <Text style={{ color: on ? accent(c) : c.fg, fontSize: 14 }}>
                  {t(`progress.race.${r.kind}`)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Text style={{ color: c.fg, fontSize: 15, fontWeight: '700' }}>
          {t('progress.currentPredictions')}
        </Text>
        {now == null ? (
          <Muted>{t('progress.noPredictions')}</Muted>
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <RaceBadge race={race} size={54} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <Text
                    style={{ color: c.fg, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] }}
                  >
                    {raceTime(now)}
                  </Text>
                  <Muted style={{ fontSize: 15 }}>
                    {racePace(now, metres(race), imperial)} {unit}
                  </Muted>
                </View>
                <Muted style={{ fontSize: 13 }}>
                  {at(from).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })} -{' '}
                  {t('progress.today')}
                </Muted>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <ChangeBadge seconds={now - points[0].value} />
                <Muted style={{ fontSize: 12 }}>{t(`progress.predLast.${range}`)}</Muted>
              </View>
            </View>
            <PredictionChart points={points} from={from} to={today} ticks={ticks} labels={labels} />
          </>
        )}
      </>
    );
  })();

  return (
    <Screen header>
      <Stack.Screen options={{ headerRight: () => <InfoButton text={t('progress.predictionsInfo')} /> }} />
      {body}
      <View
        accessibilityRole="radiogroup"
        style={{
          flexDirection: 'row',
          marginTop: 16,
          borderRadius: 999,
          borderWidth: 1.5,
          borderColor: c.line,
          overflow: 'hidden',
        }}
      >
        {(['today', '1m', '3m', '6m'] as const).map((r) => {
          const on = r === range;
          return (
            <Pressable
              key={r}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => setRange(r)}
              style={{
                flex: 1,
                flexDirection: 'row',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 6,
                paddingVertical: 12,
                backgroundColor: on ? c.surface2 : 'transparent',
              }}
            >
              {on && <Icon name="check" color={c.fg} size={18} />}
              <Text style={{ color: c.fg, fontSize: 14, fontWeight: on ? '700' : '400' }}>
                {t(`progress.predRange.${r}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}
