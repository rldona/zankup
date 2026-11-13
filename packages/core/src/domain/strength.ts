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

/** A workout's totals, for the figures over its sets: active sets, reps, volume, and the time spent
 * working and resting. */
export interface StrengthTotals {
  sets: number;
  reps: number;
  volume_kg: number;
  work_s: number;
  rest_s: number;
}

export function strengthTotals(sets: readonly StrengthSet[]): StrengthTotals {
  const totals: StrengthTotals = { sets: 0, reps: 0, volume_kg: 0, work_s: 0, rest_s: 0 };
  for (const set of sets) {
    if (set.kind === 'active') {
      totals.sets += 1;
      totals.reps += set.reps ?? 0;
      totals.volume_kg += (set.reps ?? 0) * (set.weight_kg ?? 0);
      totals.work_s += set.duration_s;
    } else if (set.kind === 'rest') totals.rest_s += set.duration_s;
  }
  return totals;
}

/** The session's flow: each set and rest in order, with its share of the time (0 to 1) and, for a
 * set, the index of its exercise group from `groupSets` (null for a rest). */
export interface FlowSegment {
  kind: 'active' | 'rest';
  share: number;
  group: number | null;
}

export function strengthFlow(sets: readonly StrengthSet[]): FlowSegment[] {
  const total = sets.reduce(
    (s, set) => s + (set.kind === 'active' || set.kind === 'rest' ? set.duration_s : 0),
    0,
  );
  if (total <= 0) return [];
  const flow: FlowSegment[] = [];
  let group = -1;
  let category: string | null | undefined;
  for (const set of sets) {
    if (set.kind === 'active') {
      if (group < 0 || set.category !== category) {
        group += 1;
        category = set.category;
      }
      flow.push({ kind: 'active', share: set.duration_s / total, group });
    } else if (set.kind === 'rest') flow.push({ kind: 'rest', share: set.duration_s / total, group: null });
  }
  return flow;
}

/** Every muscle group worked, with how many sets worked it (for the body map's intensity). */
export function musclesWorked(sets: readonly StrengthSet[]): Map<Muscle, number> {
  const exercises: Record<string, number> = {};
  for (const set of sets) {
    if (set.kind !== 'active' || !set.category) continue;
    exercises[set.category] = (exercises[set.category] ?? 0) + 1;
  }
  return musclesFromExercises(exercises);
}

/** The same from the sets per exercise a feed card carries (`exercises`, OS-225). */
export function musclesFromExercises(
  exercises: Readonly<Record<string, number>> | null | undefined,
): Map<Muscle, number> {
  const worked = new Map<Muscle, number>();
  for (const [category, sets] of Object.entries(exercises ?? {}))
    for (const muscle of EXERCISE_MUSCLES[category] ?? [])
      worked.set(muscle, (worked.get(muscle) ?? 0) + sets);
  return worked;
}

/** Simple outlines of each muscle group, front and back, drawn on a 100×200 figure (web and app). */
export const BODY_SHAPES: Record<'front' | 'back', Partial<Record<Muscle, string[]>>> = {
  front: {
    shoulders: ['M27 44 q-8 2 -9 12 l9 2 z', 'M73 44 q8 2 9 12 l-9 2 z'],
    chest: ['M31 46 h17 v14 q-10 2 -17 -2 z', 'M52 46 h17 v12 q-7 4 -17 2 z'],
    biceps: ['M18 58 l8 1 l-1 18 l-8 -1 z', 'M82 58 l-8 1 l1 18 l8 -1 z'],
    forearms: ['M16 79 l8 1 l-2 22 l-7 -1 z', 'M84 79 l-8 1 l2 22 l7 -1 z'],
    abs: ['M42 62 h16 v30 h-16 z'],
    obliques: ['M33 64 l8 0 v26 l-7 -4 z', 'M67 64 l-8 0 v26 l7 -4 z'],
    quads: ['M33 104 h15 l-2 40 h-11 z', 'M52 104 h15 l-2 40 h-11 z'],
    calves: ['M35 150 h10 l-1 32 h-7 z', 'M55 150 h10 l-2 32 h-7 z'],
  },
  back: {
    traps: ['M38 38 h24 l6 8 h-36 z'],
    shoulders: ['M27 44 q-8 2 -9 12 l9 2 z', 'M73 44 q8 2 9 12 l-9 2 z'],
    lats: ['M31 48 h38 l-4 26 h-30 z'],
    triceps: ['M18 58 l8 1 l-1 18 l-8 -1 z', 'M82 58 l-8 1 l1 18 l8 -1 z'],
    lower_back: ['M37 76 h26 v14 h-26 z'],
    glutes: ['M33 92 h16 v14 h-16 z', 'M51 92 h16 v14 h-16 z'],
    hamstrings: ['M33 108 h15 l-2 38 h-11 z', 'M52 108 h15 l-2 38 h-11 z'],
    calves: ['M35 150 h10 l-1 32 h-7 z', 'M55 150 h10 l-2 32 h-7 z'],
  },
};

export const BODY_SILHOUETTE =
  'M50 6 a10 11 0 1 1 -0.1 0 z M38 36 h24 l14 6 q8 2 9 12 l-1 26 l-2 24 l-6 -1 l1 -22 l-3 -16 l-4 20 l2 18 l-1 42 l-3 36 h-10 l-2 -36 l-3 -30 h-2 l-3 30 l-2 36 h-10 l-3 -36 l-1 -42 l2 -18 l-4 -20 l-3 16 l1 22 l-6 1 l-2 -24 l-1 -26 q1 -10 9 -12 z';
