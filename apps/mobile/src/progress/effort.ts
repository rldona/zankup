/**
 * Relative effort by week (as Strava's): the week's score is the sum of its activities' effort (the
 * engine's TRIMP, `load`), and its range comes from the three weeks before it: from two thirds to four
 * thirds of their average (Strava's "171-341" around 256). Pure, so it is unit-tested.
 */

export type EffortRange = { lo: number; hi: number };
export type EffortStatus = 'below' | 'in' | 'above' | 'far';

/** The range a week is judged against, from the weeks just before it (none without any effort). */
export function weeklyRange(before: number[]): EffortRange | null {
  const last = before.slice(-3);
  if (!last.length) return null;
  const average = last.reduce((a, b) => a + b, 0) / last.length;
  if (average <= 0) return null;
  return { lo: Math.round((average * 2) / 3), hi: Math.round((average * 4) / 3) };
}

/** Where a score falls: under, in, over, or well over (half again above the top) its range. */
export function effortStatus(score: number, range: EffortRange | null): EffortStatus {
  if (!range) return 'in';
  if (score < range.lo) return 'below';
  if (score <= range.hi) return 'in';
  return score > range.hi * 1.5 ? 'far' : 'above';
}

/** Running totals through the week, Monday first; days after `upTo` (today) are left out. */
export function cumulative(days: number[], upTo = days.length - 1): number[] {
  let sum = 0;
  return days.slice(0, upTo + 1).map((v) => (sum += v));
}

/** An activity's effort band, for its colour: light, moderate or hard. */
export function activityBand(effort: number): 'light' | 'moderate' | 'hard' {
  if (effort < 50) return 'light';
  return effort < 150 ? 'moderate' : 'hard';
}
