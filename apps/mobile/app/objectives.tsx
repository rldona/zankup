/**
 * Goals, from Progress (as Strava's): each goal with its ring, where it stands (so far, to go or extra,
 * and for months and years whether it is behind an even pace), a menu to edit or delete it, and a fold
 * with this period's totals and its chart. The + adds one.
 */
import { goalsQuery, volumeQuery, type GoalOut } from '@zankup/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { useApi } from '../src/auth';
import { openGoals, rememberGoal } from '../src/storage';
import { Icon } from '../src/Icon';
import { t } from '../src/i18n';
import { isoDay } from '../src/progress/fitness';
import { behind, chartPeriods, left, type GoalMetric, type GoalPeriod } from '../src/progress/goals';
import { GoalChart, GoalRing, goalWords } from '../src/progress/GoalsCard';
import { Panel } from '../src/progress/Panel';
import { metricOf, type Bucket } from '../src/progress/volume';
import { useVolumeFormat } from '../src/progress/VolumeCard';
import { PageSkeleton } from '../src/Skeleton';
import { useTheme } from '../src/theme';
import { Muted, Screen } from '../src/ui';

export default function ObjectivesScreen() {
  const api = useApi();
  const c = useTheme();
  const goals = useQuery(goalsQuery(api));
  return (
    <Screen header>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('progress.newGoal')}
              hitSlop={10}
              onPress={() => router.push('/objective-new')}
            >
              <Icon name="add" color={c.fg} size={30} />
            </Pressable>
          ),
        }}
      />
      {goals.isPending ? (
        <PageSkeleton cards={3} />
      ) : !goals.data?.length ? (
        <Muted>{t('progress.noGoals')}</Muted>
      ) : (
        goals.data.map((g) => <GoalBlock key={g.id} goal={g} />)
      )}
    </Screen>
  );
}

function GoalBlock({ goal }: { goal: GoalOut }) {
  const api = useApi();
  const c = useTheme();
  const format = useVolumeFormat();
  const queryClient = useQueryClient();
  // Open or folded as it was left, on this phone.
  const [open, setOpen] = useState(() => openGoals().has(goal.id));
  const [menu, setMenu] = useState(false);
  const metric = goal.metric as GoalMetric;
  const period = goal.period as GoalPeriod;
  const today = isoDay(new Date());
  const { title, note } = goalWords(goal);
  const rest = left(goal);
  const late = behind(goal, today);
  const stat = (label: string, value: number) => (
    <View>
      <Text style={{ color: c.fg, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: c.fg, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
        {format.value(metric, value, 1)}
      </Text>
    </View>
  );
  const remove = () =>
    Alert.alert(t('progress.deleteGoal'), t('progress.deleteGoalConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('progress.deleteGoal'),
        style: 'destructive',
        onPress: async () => {
          await api.DELETE('/api/goals/{goal_id}', { params: { path: { goal_id: goal.id } } });
          void queryClient.invalidateQueries({ queryKey: goalsQuery(api).queryKey });
        },
      },
    ]);
  return (
    <View
      style={{ marginHorizontal: -16, backgroundColor: c.surface, borderBottomWidth: 6, borderColor: c.bg }}
    >
      <View style={{ padding: 16, gap: 18 }}>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <GoalRing goal={goal} size={52} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.fg, fontSize: 16 }}>{title}</Text>
            <Text style={{ color: c.fg, fontSize: 14 }}>{note}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('progress.goalMenu')}
            hitSlop={12}
            onPress={() => setMenu(true)}
          >
            <Icon name="more_horiz" color={c.fg} size={26} />
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: 32 }}>
          {stat(t('progress.soFar'), goal.current)}
          {rest >= 0 ? stat(t('progress.toGo'), rest) : stat(t('progress.extra'), -rest)}
          {period !== 'week' &&
            rest > 0 &&
            (late > 0 ? stat(t('progress.behind'), late) : stat(t('progress.ahead'), -late))}
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          setOpen(!open);
          rememberGoal(goal.id, !open);
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: 16,
          backgroundColor: open ? c.surface2 : undefined,
        }}
      >
        <Text style={{ flex: 1, color: c.fg, fontSize: 14, fontWeight: '700' }}>
          {open
            ? null
            : period === 'week'
              ? t('progress.last12Weeks')
              : period === 'month'
                ? t('progress.last12Months')
                : t('progress.seeProgress')}
        </Text>
        <Icon name={open ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} color={c.fg} size={26} />
      </Pressable>
      {open && <GoalFold goal={goal} />}
      <Panel open={menu} onClose={() => setMenu(false)}>
        <View style={{ paddingHorizontal: 16 }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setMenu(false);
              router.push({ pathname: '/objective-new', params: { id: String(goal.id) } });
            }}
            style={{ flexDirection: 'row', gap: 14, alignItems: 'center', paddingVertical: 14 }}
          >
            <Icon name="edit" color={c.fg} size={24} />
            <Text style={{ color: c.fg, fontSize: 15 }}>{t('progress.editGoal')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setMenu(false);
              remove();
            }}
            style={{ flexDirection: 'row', gap: 14, alignItems: 'center', paddingVertical: 14 }}
          >
            <Icon name="delete" color={c.formNegative} size={24} />
            <Text style={{ color: c.formNegative, fontSize: 15 }}>{t('progress.deleteGoal')}</Text>
          </Pressable>
        </View>
      </Panel>
    </View>
  );
}

/** The fold: this period's totals for the goal's sport, then the goal over its weeks, months or year. */
function GoalFold({ goal }: { goal: GoalOut }) {
  const api = useApi();
  const c = useTheme();
  const format = useVolumeFormat();
  const period = goal.period as GoalPeriod;
  const metric = goal.metric as GoalMetric;
  const range = chartPeriods(period, isoDay(new Date()));
  const volume = useQuery(volumeQuery(api, { from: range.from, to: range.to }, range.unit));
  const buckets = (volume.data ?? []) as Bucket[];
  const of = (b: Bucket) => (goal.sport ? b.by_sport[goal.sport] : b.totals);
  const now = buckets.at(-1);
  const totals = period === 'year' ? buckets.map(of) : [now ? of(now) : undefined];
  const sum = (m: GoalMetric) => totals.reduce((s, x) => s + metricOf(x, m), 0);
  const values = buckets.map((b) => metricOf(of(b), metric));
  return (
    <View
      style={{
        backgroundColor: c.surface2,
        paddingHorizontal: 16,
        paddingBottom: 20,
        gap: 14,
        marginTop: -16,
      }}
    >
      <Text style={{ color: c.fg, fontSize: 14, fontWeight: '700' }}>
        {[
          format.value('distance', sum('distance'), 1),
          format.value('time', sum('time')),
          format.value('ascent', sum('ascent')),
          t('progress.activitiesCount', { count: sum('count') }),
        ].join('  ')}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Muted style={{ flex: 1, fontSize: 14 }}>{t(`progress.metricShort.${metric}`)}</Muted>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.muted }} />
          <Muted style={{ fontSize: 14 }}>{t('progress.goalTarget')}</Muted>
          <View
            style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.accent, marginLeft: 10 }}
          />
          <Muted style={{ fontSize: 14 }}>{t('progress.goalActual')}</Muted>
        </View>
      </View>
      {buckets.length > 0 && (
        <GoalChart
          period={period}
          target={goal.target}
          starts={buckets.map((b) => b.start)}
          values={values}
        />
      )}
    </View>
  );
}
