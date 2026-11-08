/**
 * Strength workouts (OS-225): sets grouped by exercise, their volume, and the muscle groups each
 * exercise works, for the body map. Shared with the Android app.
 */

export type Muscle =
  | 'chest'
  | 'shoulders'
  | 'biceps'
  | 'forearms'
  | 'abs'
  | 'obliques'
  | 'quads'
  | 'traps'
  | 'lats'
  | 'triceps'
  | 'lower_back'
  | 'glutes'
  | 'hamstrings'
  | 'calves';

export const FRONT: readonly Muscle[] = [
  'chest',
  'shoulders',
  'biceps',
  'forearms',
  'abs',
  'obliques',
  'quads',
  'calves',
];
export const BACK: readonly Muscle[] = [
  'traps',
  'shoulders',
  'lats',
  'triceps',
  'lower_back',
  'glutes',
  'hamstrings',
  'calves',
];

/** The FIT exercise categories and the muscle groups they mainly work. */
export const EXERCISE_MUSCLES: Record<string, readonly Muscle[]> = {
  bench_press: ['chest', 'triceps', 'shoulders'],
  calf_raise: ['calves'],
  cardio: ['quads', 'calves'],
  carry: ['forearms', 'traps', 'abs'],
  chop: ['obliques', 'abs', 'shoulders'],
  core: ['abs', 'obliques', 'lower_back'],
  crunch: ['abs'],
  curl: ['biceps', 'forearms'],
  deadlift: ['hamstrings', 'glutes', 'lower_back', 'traps'],
  flye: ['chest', 'shoulders'],
  hip_raise: ['glutes', 'hamstrings'],
  hip_stability: ['glutes'],
  hip_swing: ['glutes', 'hamstrings'],
  hyperextension: ['lower_back', 'glutes'],
  lateral_raise: ['shoulders'],
  leg_curl: ['hamstrings'],
  leg_raise: ['abs'],
  lunge: ['quads', 'glutes'],
  olympic_lift: ['quads', 'glutes', 'shoulders', 'traps'],
  plank: ['abs', 'obliques'],
  plyo: ['quads', 'calves'],
  pull_up: ['lats', 'biceps'],
  push_up: ['chest', 'triceps', 'shoulders'],
  row: ['lats', 'biceps', 'traps'],
  shoulder_press: ['shoulders', 'triceps'],
  shoulder_stability: ['shoulders'],
  shrug: ['traps'],
  sit_up: ['abs'],
  squat: ['quads', 'glutes', 'hamstrings'],
  total_body: ['quads', 'chest', 'lats', 'abs'],
  triceps_extension: ['triceps'],
  warm_up: [],
  run: [],
};

export interface StrengthSet {
  start_s: number;
  duration_s: number;
  kind: string;
  reps: number | null;
  weight_kg: number | null;
  category: string | null;
}

export interface ExerciseGroup {
  category: string | null;
  sets: (StrengthSet & { rest_s: number | null })[];
  reps: number;
  volume_kg: number;
}

/** Active sets grouped by exercise in the order done (a new group when the exercise changes), each
 * with the rest that followed it. */
export function groupSets(sets: readonly StrengthSet[]): ExerciseGroup[] {
  const groups: ExerciseGroup[] = [];
  sets.forEach((set, i) => {
    if (set.kind !== 'active') return;
    const next = sets[i + 1];
    const rest = next?.kind === 'rest' ? next.duration_s : null;
    let group = groups.at(-1);
    if (!group || group.category !== set.category) {
      group = { category: set.category, sets: [], reps: 0, volume_kg: 0 };
      groups.push(group);
    }
    group.sets.push({ ...set, rest_s: rest });
    group.reps += set.reps ?? 0;
    group.volume_kg += (set.reps ?? 0) * (set.weight_kg ?? 0);
  });
  return groups;
}

/** Every muscle group worked, with how many sets worked it (for the body map's intensity). */
export function musclesWorked(sets: readonly StrengthSet[]): Map<Muscle, number> {
  const worked = new Map<Muscle, number>();
  for (const set of sets) {
    if (set.kind !== 'active' || !set.category) continue;
    for (const muscle of EXERCISE_MUSCLES[set.category] ?? [])
      worked.set(muscle, (worked.get(muscle) ?? 0) + 1);
  }
  return worked;
}
