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

/**
 * The body figure, front and back, on a 100×200 box (web and app): each muscle group's shape, drawn as
 * rounded muscles inside the outline, with the left half mirrored so it is symmetric. Made for Zankup
 * (scripts: a left half and its mirror), in the manner of Strava's body map.
 */
export const BODY_SHAPES: Record<'front' | 'back', Partial<Record<Muscle, string[]>>> = {
  front: {
    shoulders: [
      'M27.2 37.2C22.6 38.6 20.2 42.4 20 48C20 51.6 20.4 54.4 21.4 56.6C23.6 53.4 26.4 50 28.8 46.6C29.8 43.4 29.6 39.2 27.2 37.2Z',
      'M72.8 37.2C77.4 38.6 79.8 42.4 80 48C80 51.6 79.6 54.4 78.6 56.6C76.4 53.4 73.6 50 71.2 46.6C70.2 43.4 70.4 39.2 72.8 37.2Z',
    ],
    chest: [
      'M31 38.6C36 37.2 43.6 37.4 48.6 39.4L48.6 52.4C44 55.6 37.4 55.8 32.4 52.6C30 50.6 29.6 46.4 30.2 42.4C30.4 40.8 30.6 39.6 31 38.6Z',
      'M69 38.6C64 37.2 56.4 37.4 51.4 39.4C51.4 39.4 51.4 52.4 51.4 52.4C56 55.6 62.6 55.8 67.6 52.6C70 50.6 70.4 46.4 69.8 42.4C69.6 40.8 69.4 39.6 69 38.6Z',
    ],
    biceps: [
      'M20.4 58C22.4 55.6 25.6 55.4 26.2 58C26.4 64 25.6 70 24.4 75.6C23 78 21 78 19.8 75.8C18.8 70 19 63.6 20.4 58Z',
      'M79.6 58C77.6 55.6 74.4 55.4 73.8 58C73.6 64 74.4 70 75.6 75.6C77 78 79 78 80.2 75.8C81.2 70 81 63.6 79.6 58Z',
    ],
    forearms: [
      'M15.8 84C17.2 80.6 21.2 80.4 22.4 83.6C21.8 91 20.4 99 18.8 106.6C17.8 109 15.6 109 15 106.8C14.2 99 14.6 90.4 15.8 84Z',
      'M84.2 84C82.8 80.6 78.8 80.4 77.6 83.6C78.2 91 79.6 99 81.2 106.6C82.2 109 84.4 109 85 106.8C85.8 99 85.4 90.4 84.2 84Z',
    ],
    abs: [
      'M43 56.6C45 56 47.4 56 49.2 56.4L49.2 64C47.2 64.6 45 64.6 43 64C42.6 61.4 42.6 59 43 56.6Z',
      'M57 56.6C55 56 52.6 56 50.8 56.4C50.8 56.4 50.8 64 50.8 64C52.8 64.6 55 64.6 57 64C57.4 61.4 57.4 59 57 56.6Z',
      'M42.8 66C45 65.6 47.2 65.6 49.2 65.8L49.2 73.4C47.2 73.8 45 73.8 42.8 73.4C42.4 71 42.4 68.4 42.8 66Z',
      'M57.2 66C55 65.6 52.8 65.6 50.8 65.8C50.8 65.8 50.8 73.4 50.8 73.4C52.8 73.8 55 73.8 57.2 73.4C57.6 71 57.6 68.4 57.2 66Z',
      'M42.8 75C45 74.8 47.2 74.8 49.2 75L49.2 82.6C47.2 83 45 83 42.8 82.6C42.4 80.2 42.4 77.4 42.8 75Z',
      'M57.2 75C55 74.8 52.8 74.8 50.8 75C50.8 75 50.8 82.6 50.8 82.6C52.8 83 55 83 57.2 82.6C57.6 80.2 57.6 77.4 57.2 75Z',
      'M43.2 84.4C45.2 84.2 47.4 84.2 49.2 84.4L49.2 97C47.6 99 45.6 98 44.4 95.6C43.6 92 43.2 88 43.2 84.4Z',
      'M56.8 84.4C54.8 84.2 52.6 84.2 50.8 84.4C50.8 84.4 50.8 97 50.8 97C52.4 99 54.4 98 55.6 95.6C56.4 92 56.8 88 56.8 84.4Z',
    ],
    obliques: [
      'M33.4 57.4C36 58 38.8 59 41.2 60.4L41.2 89C38.2 87.2 35.4 83 34.4 77C33.4 70.6 32.8 63.6 33.4 57.4Z',
      'M66.6 57.4C64 58 61.2 59 58.8 60.4C58.8 60.4 58.8 89 58.8 89C61.8 87.2 64.6 83 65.6 77C66.6 70.6 67.2 63.6 66.6 57.4Z',
    ],
    quads: [
      'M32.6 104.4C36.4 102.4 42 103.8 46 107.6C47 118 46.6 130 45 141.8C43.2 146.6 39.2 147.6 36.6 145.6C34.2 139.6 32.8 128 32.6 116.4C32.5 112 32.4 108 32.6 104.4Z',
      'M67.4 104.4C63.6 102.4 58 103.8 54 107.6C53 118 53.4 130 55 141.8C56.8 146.6 60.8 147.6 63.4 145.6C65.8 139.6 67.2 128 67.4 116.4C67.5 112 67.6 108 67.4 104.4Z',
    ],
    calves: [
      'M34.6 156.4C36.8 154.2 39 154.8 40 158C40.6 166 39.6 174 38 181.6C37 184 35.4 184 35 181.8C34 174 33.6 164.4 34.6 156.4Z',
      'M65.4 156.4C63.2 154.2 61 154.8 60 158C59.4 166 60.4 174 62 181.6C63 184 64.6 184 65 181.8C66 174 66.4 164.4 65.4 156.4Z',
      'M41.6 157.4C43.4 155.4 45 156 45.6 158.4C45.6 166 44.6 173.6 43.2 180C42.2 176 41.6 166.4 41.6 157.4Z',
      'M58.4 157.4C56.6 155.4 55 156 54.4 158.4C54.4 166 55.4 173.6 56.8 180C57.8 176 58.4 166.4 58.4 157.4Z',
    ],
  },
  back: {
    traps: [
      'M50 25C47.6 28 44.8 30.6 39.6 33C35.6 34.8 31.8 36.2 30 38.8C34.6 40 40 42.4 43.6 46.4C46.2 51.6 48.2 58 50 64.6C51.8 58 53.8 51.6 56.4 46.4C60 42.4 65.4 40 70 38.8C68.2 36.2 64.4 34.8 60.4 33C55.2 30.6 52.4 28 50 25Z',
    ],
    shoulders: [
      'M27.2 37.2C22.6 38.6 20.2 42.4 20 48C20 51.6 20.4 54.4 21.4 56.6C23.6 53.4 26.4 50 28.8 46.6C29.8 43.4 29.6 39.2 27.2 37.2Z',
      'M72.8 37.2C77.4 38.6 79.8 42.4 80 48C80 51.6 79.6 54.4 78.6 56.6C76.4 53.4 73.6 50 71.2 46.6C70.2 43.4 70.4 39.2 72.8 37.2Z',
    ],
    lats: [
      'M30.4 45C35 45.2 40.6 48 43.8 52.6C45.4 60.4 45.8 70.4 45.4 79.6C42 83.6 38 86.8 34.2 89.6C33.6 83.6 33 76 32.4 69.6C31.6 61.6 30.8 53.4 30.4 45Z',
      'M69.6 45C65 45.2 59.4 48 56.2 52.6C54.6 60.4 54.2 70.4 54.6 79.6C58 83.6 62 86.8 65.8 89.6C66.4 83.6 67 76 67.6 69.6C68.4 61.6 69.2 53.4 69.6 45Z',
    ],
    triceps: [
      'M19.6 50.4C21.8 48.2 25.4 48.4 26.2 52.4C26.4 60 25.6 68.4 24.2 74.8C22.8 77.2 20.8 77.2 19.6 75C18.6 67 18.4 58.2 19.6 50.4Z',
      'M80.4 50.4C78.2 48.2 74.6 48.4 73.8 52.4C73.6 60 74.4 68.4 75.8 74.8C77.2 77.2 79.2 77.2 80.4 75C81.4 67 81.6 58.2 80.4 50.4Z',
    ],
    forearms: [
      'M15.8 84C17.2 80.6 21.2 80.4 22.4 83.6C21.8 91 20.4 99 18.8 106.6C17.8 109 15.6 109 15 106.8C14.2 99 14.6 90.4 15.8 84Z',
      'M84.2 84C82.8 80.6 78.8 80.4 77.6 83.6C78.2 91 79.6 99 81.2 106.6C82.2 109 84.4 109 85 106.8C85.8 99 85.4 90.4 84.2 84Z',
    ],
    lower_back: [
      'M50 66.6C48.2 72 47.2 78 46.8 84C46.6 88 47.6 92 50 94.4C52.4 92 53.4 88 53.2 84C52.8 78 51.8 72 50 66.6Z',
    ],
    glutes: [
      'M33.2 96.4C38 93.4 44.8 94 49.2 98C49.6 104 49 110 47.2 114C43 117.2 37 117.2 34 114C32.2 109 32.2 102 33.2 96.4Z',
      'M66.8 96.4C62 93.4 55.2 94 50.8 98C50.4 104 51 110 52.8 114C57 117.2 63 117.2 66 114C67.8 109 67.8 102 66.8 96.4Z',
    ],
    hamstrings: [
      'M33.2 118.4C37.4 117.4 42.4 118.2 46.6 117.4C47 126.4 46.6 136 45 144C42 147 38 147 36 145C34 136 33.2 127 33.2 118.4Z',
      'M66.8 118.4C62.6 117.4 57.6 118.2 53.4 117.4C53 126.4 53.4 136 55 144C58 147 62 147 64 145C66 136 66.8 127 66.8 118.4Z',
    ],
    calves: [
      'M34.2 156.4C37 153.4 41 153.4 45.6 156.2C46.6 162 45.6 170 43.6 176C41 178.4 38 178.4 36 176.2C34 170 33.6 162 34.2 156.4Z',
      'M65.8 156.4C63 153.4 59 153.4 54.4 156.2C53.4 162 54.4 170 56.4 176C59 178.4 62 178.4 64 176.2C66 170 66.4 162 65.8 156.4Z',
    ],
  },
};

/** Shapes that are never worked (the inner thighs), so the figure reads as a body. */
export const BODY_DETAIL: Record<'front' | 'back', string[]> = {
  front: [
    'M46.6 109.4L48.6 112C48.6 120 48.2 128 47.2 134.6C46.6 126.4 46.8 117 46.6 109.4Z',
    'M53.4 109.4C53.4 109.4 51.4 112 51.4 112C51.4 120 51.8 128 52.8 134.6C53.4 126.4 53.2 117 53.4 109.4Z',
  ],
  back: [],
};

/** The figure's outline: head and body, to fill with the background and stroke. */
export const BODY_SILHOUETTE =
  'M50 3C55 3 58.5 7 58.5 12.5C58.5 18 55 22.5 50 22.5C45 22.5 41.5 18 41.5 12.5C41.5 7 45 3 50 3ZM50 22.5C50 22.5 46.5 22.5 46.5 22.5C46.5 26 46 28.5 44 30.5C39 33 31 33.5 26.5 35.5C21.5 37.5 19 41.5 18.5 47.5C17.8 55 17.2 63 16.6 71C16 78 14.2 84 13.2 91C12.2 99 11.6 106 11.2 112C10.2 116 9.6 120 10.6 124.5C11.6 127.5 14.2 127.5 15.2 124.5C15.8 121 16.2 118 16.8 114C18.4 106 20.4 98 21.8 90.5C22.8 84 23.8 78 24.8 72C25.6 64 26.6 57 28.4 51C29.4 61 31.2 70 32.2 80C32.8 88 31.2 94 30.8 101C30.4 113 31 127 32.6 140C33.2 146 33.6 150 33.6 154C33 162 32.2 169 33.2 176C34 182 35 186 35.2 190.5C34.2 194 32.8 197.5 36 198.5C36 198.5 45 198.5 45 198.5C46.4 196.5 45.8 193 45.2 190C45.6 182 46.8 172 46.8 164C46.8 158 46.2 154 46.6 150C47.6 138 48.6 121 49.2 110C49.2 110 50 106.5 50 106.5C50 106.5 50.8 110 50.8 110C51.4 121 52.4 138 53.4 150C53.8 154 53.2 158 53.2 164C53.2 172 54.4 182 54.8 190C54.2 193 53.6 196.5 55 198.5C55 198.5 64 198.5 64 198.5C67.2 197.5 65.8 194 64.8 190.5C65 186 66 182 66.8 176C67.8 169 67 162 66.4 154C66.4 150 66.8 146 67.4 140C69 127 69.6 113 69.2 101C68.8 94 67.2 88 67.8 80C68.8 70 70.6 61 71.6 51C73.4 57 74.4 64 75.2 72C76.2 78 77.2 84 78.2 90.5C79.6 98 81.6 106 83.2 114C83.8 118 84.2 121 84.8 124.5C85.8 127.5 88.4 127.5 89.4 124.5C90.4 120 89.8 116 88.8 112C88.4 106 87.8 99 86.8 91C85.8 84 84 78 83.4 71C82.8 63 82.2 55 81.5 47.5C81 41.5 78.5 37.5 73.5 35.5C69 33.5 61 33 56 30.5C54 28.5 53.5 26 53.5 22.5C53.5 22.5 50 22.5 50 22.5Z';
