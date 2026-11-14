/**
 * A new goal, or one being edited (`?id=`), as Strava's: the sport (all, or one, in a sheet), weekly,
 * monthly or yearly, what to measure (kinds already set for that sport and period are greyed out), and
 * the target in its units: kilometres, hours and minutes, metres or activities.
 */
import { goalsQuery, SPORTS } from '@zankup/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useApi } from '../src/auth';
import { Icon } from '../src/Icon';
import { t } from '../src/i18n';
import { useUnits } from '../src/prefs';
import { fromInput, toInput, type GoalMetric, type GoalPeriod } from '../src/progress/goals';
import { goalIcon, goalSport } from '../src/progress/GoalsCard';
import { Panel } from '../src/progress/Panel';
import { useTheme } from '../src/theme';
import { accent, Muted, onAccent, Screen } from '../src/ui';

const PERIODS: GoalPeriod[] = ['week', 'month', 'year'];
const METRICS: GoalMetric[] = ['count', 'time', 'distance', 'ascent'];

export default function ObjectiveNewScreen() {
  const api = useApi();
  const c = useTheme();
  const queryClient = useQueryClient();
  const imperial = useUnits() === 'imperial';
  const { id } = useLocalSearchParams<{ id?: string }>();
  const goals = useQuery(goalsQuery(api)).data ?? [];
  const editing = id ? goals.find((g) => g.id === Number(id)) : undefined;
  const [sport, setSport] = useState<string | null>(editing?.sport ?? null);
  const [period, setPeriod] = useState<GoalPeriod>((editing?.period as GoalPeriod) ?? 'week');
  const [metric, setMetric] = useState<GoalMetric | null>((editing?.metric as GoalMetric) ?? null);
  const start = editing ? toInput(editing.metric as GoalMetric, editing.target, imperial) : { a: '', b: '' };
  const [a, setA] = useState(start.a);
  const [b, setB] = useState(start.b ?? '');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // A sport and period can have one goal of each kind: the kinds already taken are greyed out.
  const taken = new Set(
    goals
      .filter((g) => g.id !== editing?.id && g.period === period && (g.sport ?? null) === sport)
      .map((g) => g.metric),
  );
  const target = metric ? fromInput(metric, a, b, imperial) : 0;
  const typed = a !== '' || b !== '';
  const valid = metric != null && !taken.has(metric) && target > 0;

  const save = async () => {
    if (!valid || !metric) return;
    setBusy(true);
    setFailed(false);
    const body = { period, metric, sport, target };
    const { error } = editing
      ? await api.PATCH('/api/goals/{goal_id}', { params: { path: { goal_id: editing.id } }, body })
      : await api.POST('/api/goals', { body });
    setBusy(false);
    if (error) return setFailed(true);
    void queryClient.invalidateQueries({ queryKey: goalsQuery(api).queryKey });
    router.back();
  };

  const pill = (on: boolean, label: string, onPress: () => void, disabled = false, basis = '30%') => (
    <Pressable
      key={label}
      accessibilityRole="radio"
      accessibilityState={{ checked: on, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        flexGrow: 1,
        flexBasis: basis as `${number}%`,
        alignItems: 'center',
        paddingVertical: 16,
        borderRadius: 999,
        borderWidth: 1.5,
        borderColor: on ? accent(c) : disabled ? 'transparent' : c.line,
        backgroundColor: disabled ? c.surface2 : 'transparent',
      }}
    >
      <Text style={{ color: on ? accent(c) : disabled ? c.muted : c.fg, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
  const field = (value: string, onChange: (v: string) => void, unit: string) => (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 }}>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={c.fg}
        style={{ color: c.fg, fontSize: 16, paddingVertical: 16, minWidth: 30 }}
      />
      <Text style={{ color: c.fg, fontSize: 16 }}> {unit}</Text>
    </View>
  );
  const unit =
    metric === 'distance' ? (imperial ? 'mi' : 'km') : metric === 'ascent' ? (imperial ? 'ft' : 'm') : '';

  return (
    <Screen header>
      <Stack.Screen options={{ title: editing ? t('progress.editGoal') : t('progress.newGoal') }} />
      <Text style={{ color: c.fg, fontSize: 17, fontWeight: '800' }}>{t('progress.chooseSports')}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => setPicking(true)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: 16,
          borderRadius: 12,
          borderWidth: 1.5,
          borderColor: c.line,
        }}
      >
        <Icon name={goalIcon(sport)} color={c.fg} size={24} />
        <Text style={{ flex: 1, color: c.fg, fontSize: 15 }}>{goalSport(sport)}</Text>
        <Icon name="keyboard_arrow_down" color={c.fg} size={24} />
      </Pressable>

      <Text style={{ color: c.fg, fontSize: 17, fontWeight: '800', marginTop: 8 }}>
        {t('progress.whichPeriod')}
      </Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {PERIODS.map((p) => pill(p === period, t(`progress.goalPeriod.${p}`), () => setPeriod(p)))}
      </View>

      <Text style={{ color: c.fg, fontSize: 17, fontWeight: '800', marginTop: 8 }}>
        {t('progress.whichKind')}
      </Text>
      {taken.size > 0 && <Text style={{ color: c.fg, fontSize: 14 }}>{t('progress.kindTaken')}</Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {METRICS.map((m) =>
          pill(
            m === metric,
            m === 'count' ? t('progress.metricShort.count') : t(`progress.metric.${m}`),
            () => {
              setMetric(m);
              setA('');
              setB('');
            },
            taken.has(m),
            '45%',
          ),
        )}
      </View>

      {metric && !taken.has(metric) && (
        <>
          <Text style={{ color: c.fg, fontSize: 17, fontWeight: '800', marginTop: 8 }}>
            {t('progress.whatTarget')}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              borderRadius: 12,
              borderWidth: 1.5,
              borderColor: c.line,
              backgroundColor: c.bg,
            }}
          >
            {metric === 'time' ? (
              <>
                {field(a, setA, 'h')}
                <View style={{ width: 1.5, backgroundColor: c.line }} />
                {field(b, setB, 'min')}
              </>
            ) : (
              field(a, setA, unit)
            )}
          </View>
          {typed && !valid && (
            <Text style={{ color: c.formNegative, fontSize: 13 }}>{t('progress.targetInvalid')}</Text>
          )}
        </>
      )}
      {failed && <Text style={{ color: c.formNegative }}>{t('progress.goalSaveError')}</Text>}

      <Pressable
        accessibilityRole="button"
        disabled={!valid || busy}
        onPress={() => void save()}
        style={{
          marginTop: 24,
          alignItems: 'center',
          paddingVertical: 16,
          borderRadius: 999,
          backgroundColor: accent(c),
          opacity: valid && !busy ? 1 : 0.4,
        }}
      >
        <Text style={{ color: onAccent(c), fontSize: 15, fontWeight: '700' }}>{t('progress.saveGoal')}</Text>
      </Pressable>

      <Panel open={picking} onClose={() => setPicking(false)}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }}>
          <Text style={{ color: c.fg, fontSize: 17, fontWeight: '800', marginBottom: 8 }}>
            {t('progress.filterSport')}
          </Text>
          {[null, ...SPORTS].map((s) => {
            const on = s === sport;
            return (
              <Pressable
                key={s ?? 'all'}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => {
                  setSport(s);
                  setPicking(false);
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14 }}
              >
                <Icon name={goalIcon(s)} color={on ? accent(c) : c.fg} size={26} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: on ? accent(c) : c.fg, fontSize: 15 }}>{goalSport(s)}</Text>
                  {!s && <Muted style={{ fontSize: 13 }}>{t('progress.goalAllSportsNote')}</Muted>}
                </View>
                {on && <Icon name="check" color={accent(c)} size={24} />}
              </Pressable>
            );
          })}
        </ScrollView>
      </Panel>
    </Screen>
  );
}
