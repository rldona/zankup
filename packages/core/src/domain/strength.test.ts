import { describe, expect, it } from 'vitest';

import { groupSets, musclesWorked, type StrengthSet } from './strength';

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
});
