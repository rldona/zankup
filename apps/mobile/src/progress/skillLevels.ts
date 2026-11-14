/**
 * Skills on Progress (as Strava's): a rider's best power over twelve durations, grouped in three
 * skills (sprint, attack and climb), each placed on a nine-level scale by watts per kilo. Pure, so it is
 * unit-tested; the bests come from the power curve (/api/stats/curves).
 *
 * The scale runs, at each duration, from what a beginner holds to what the best riders do, after the
 * shape of Coggan's power profile (W/kg): 8–24 at 5 s, 4.5–11.5 at 1 min, 2.5–7.6 at 5 min and
 * 1.8–6.4 at an hour, read in between on a log scale of time.
 */

export type Skill = 'sprint' | 'attack' | 'climb';

export const SKILLS: { skill: Skill; durations: number[] }[] = [
  { skill: 'sprint', durations: [15, 30, 60] },
  { skill: 'attack', durations: [120, 180, 300, 600] },
  { skill: 'climb', durations: [900, 1200, 1800, 2700, 3600] },
];

/** The spokes of the chart, clockwise from the top: every duration once. */
export const DURATIONS = SKILLS.flatMap((s) => s.durations);

export const LEVELS = 9;

const ANCHORS: [number, number, number][] = [
  [5, 8, 24],
  [60, 4.5, 11.5],
  [300, 2.5, 7.6],
  [3600, 1.8, 6.4],
];

/** The W/kg range at a duration: beginner to the best, between the anchors on a log scale of time. */
export function scaleAt(duration: number): [number, number] {
  const t = Math.log(duration);
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const [d0, lo0, hi0] = ANCHORS[i];
    const [d1, lo1, hi1] = ANCHORS[i + 1];
    if (duration <= d1 || i === ANCHORS.length - 2) {
      const f = Math.min(1, Math.max(0, (t - Math.log(d0)) / (Math.log(d1) - Math.log(d0))));
      return [lo0 + (lo1 - lo0) * f, hi0 + (hi1 - hi0) * f];
    }
  }
  return [ANCHORS[0][1], ANCHORS[0][2]];
}

/** Where watts put a rider at a duration: from 0 (nothing) to 9 (the best), fractional. */
export function levelAt(watts: number, duration: number, weightKg: number): number {
  if (watts <= 0 || weightKg <= 0) return 0;
  const [lo, hi] = scaleAt(duration);
  return Math.min(LEVELS, Math.max(0, 1 + ((LEVELS - 1) * (watts / weightKg - lo)) / (hi - lo)));
}

/** A skill's level: the average of its durations', so one lucky effort does not carry it. */
export function skillLevel(levels: number[]): number {
  return levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : 0;
}

/** The nine levels' names (i18n keys progress.level.1 … 9) from the whole level. */
export const levelName = (level: number) => Math.max(1, Math.min(LEVELS, Math.floor(level)));

/**
 * How a level fills the nine segments of a bar: each full one, then the part of the one it is in.
 * Segments narrow towards the top, as levels get harder to climb.
 */
export function segments(level: number): number[] {
  return Array.from({ length: LEVELS }, (_, i) => Math.max(0, Math.min(1, level - i)));
}

export const SEGMENT_WIDTHS = [3, 1.5, 1, 1.5, 1.4, 0.9, 0.3, 0.2, 0.2];

/** The card's line: the strongest skill and, in it, the duration that is highest on the scale. */
export function strongest(
  bests: Map<number, number>,
  weightKg: number,
): { skill: Skill; duration: number; watts: number; level: number } | null {
  let out: { skill: Skill; duration: number; watts: number; level: number } | null = null;
  let top = 0;
  for (const { skill, durations } of SKILLS) {
    const levels = durations.map((d) => levelAt(bests.get(d) ?? 0, d, weightKg));
    const level = skillLevel(levels);
    if (level > top) {
      top = level;
      const i = levels.indexOf(Math.max(...levels));
      out = { skill, duration: durations[i], watts: bests.get(durations[i]) ?? 0, level };
    }
  }
  return out;
}

/** 15 s · 2 min · 1 h. */
export function durationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${seconds / 60} min`;
  return `${seconds / 3600} h`;
}
