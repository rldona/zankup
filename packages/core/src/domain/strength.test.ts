import { describe, expect, it } from 'vitest';

import {
  groupSets,
  musclesFromExercises,
  musclesWorked,
  strengthFlow,
  strengthTotals,
  type StrengthSet,
} from './strength';

const set = (category: string | null, reps: number, weight: number | null, kind = 'active'): StrengthSet => ({
  start_s: 0,
  duration_s: kind === 'rest' ? 90 : 40,
  kind,
  reps,
  weight_kg: weight,
  category,
});

const WORKOUT = [
  set('squat', 8, 60),
  set(null, 0, null, 'rest'),
  set('squat', 6, 70),
  set(null, 0, null, 'rest'),
  set('bench_press', 10, 40),
  set('curl', 12, null),
];

describe('strength sets', () => {
  it('groups sets by exercise with their rests, reps and volume', () => {
    const groups = groupSets(WORKOUT);
    expect(groups.map((g) => [g.category, g.sets.length, g.reps, g.volume_kg])).toEqual([
      ['squat', 2, 14, 900],
      ['bench_press', 1, 10, 400],
      ['curl', 1, 12, 0],
    ]);
    expect(groups[0]?.sets.map((s) => s.rest_s)).toEqual([90, 90]);
    expect(groups[1]?.sets[0]?.rest_s).toBeNull();
  });

  it('lists the muscles worked', () => {
    const muscles = musclesWorked(WORKOUT);
    expect(muscles.get('quads')).toBe(2);
    expect(muscles.get('chest')).toBe(1);
    expect(muscles.get('biceps')).toBe(1);
    expect(muscles.has('calves')).toBe(false);
  });

  it('reads the same muscles from the sets per exercise of a feed card', () => {
    expect([...musclesFromExercises({ row: 2, curl: 1 })]).toEqual([
      ['lats', 2],
      ['biceps', 3],
      ['traps', 2],
      ['forearms', 1],
    ]);
    expect(musclesFromExercises(null).size).toBe(0);
    expect(musclesFromExercises({ warm_up: 3, unknown_thing: 1 }).size).toBe(0);
  });

  it('adds up the sets, the volume and the time working and resting', () => {
    const sets = [set('row', 10, 40), set(null, 0, null, 'rest'), set('row', 8, 50), set('curl', 12, null)];
    expect(strengthTotals(sets)).toEqual({ sets: 3, reps: 30, volume_kg: 800, work_s: 120, rest_s: 90 });
  });

  it('lays the session out in order, each set with its exercise group', () => {
    const sets = [set('row', 10, 40), set(null, 0, null, 'rest'), set('row', 8, 50), set('curl', 12, null)];
    const flow = strengthFlow(sets);
    expect(flow.map((f) => [f.kind, f.group])).toEqual([
      ['active', 0],
      ['rest', null],
      ['active', 0],
      ['active', 1],
    ]);
    expect(flow.reduce((s, f) => s + f.share, 0)).toBeCloseTo(1);
    expect(strengthFlow([])).toEqual([]);
  });
});
