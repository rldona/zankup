/**
 * Goals on Progress (as Strava's): how far along a goal is, what is left or extra, whether a long goal
 * is behind or ahead of an even pace, and the weeks or months to chart it over. Pure, so it is
 * unit-tested; the goals come from /api/goals.
 */
import { addDays, mondayOf } from './weeks';

export type GoalPeriod = 'week' | 'month' | 'year';
export type GoalMetric = 'distance' | 'time' | 'ascent' | 'count';
export type GoalLike = {
  period: string;
  metric: string;
  target: number;
  current: number;
  start: string;
  end: string;
};

/** How full the ring is: 0 to 1. */
export const fraction = (g: GoalLike) => (g.target > 0 ? Math.min(1, g.current / g.target) : 0);

/** What is left to do (positive) or done over the target (negative). */
export const left = (g: GoalLike) => g.target - g.current;

/**
 * Against an even pace through the period, as of today: positive when behind (what an even pace would
 * have done by now and has not), negative when ahead. Strava shows it on goals longer than a week.
 */
export function behind(g: GoalLike, today: string): number {
  const at = (iso: string) => new Date(`${iso}T12:00:00`).getTime();
  const length = (at(g.end) - at(g.start)) / 86_400_000;
  const elapsed = Math.min(length, (at(today) - at(g.start)) / 86_400_000 + 1);
  return (g.target * elapsed) / length - g.current;
}

/** The periods a goal is charted over: the last 12 weeks or months, or the months of the year. */
export function chartPeriods(
  period: GoalPeriod,
  today: string,
): { from: string; to: string; unit: 'week' | 'month' } {
  const tomorrow = addDays(today, 1);
  if (period === 'week') return { from: addDays(mondayOf(today), -77), to: tomorrow, unit: 'week' };
  const [y, m] = today.split('-').map(Number);
  if (period === 'month') {
    const d = new Date(y, m - 1 - 11, 1);
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    return { from, to: tomorrow, unit: 'month' };
  }
  return { from: `${y}-01-01`, to: tomorrow, unit: 'month' };
}

/** Running totals, for a year's line against its target's diagonal. */
export function runningTotal(values: number[]): number[] {
  let sum = 0;
  return values.map((v) => (sum += v));
}

/**
 * A goal in the units it is typed in, and back: kilometres (or miles) for distance, hours and minutes
 * for time, metres (or feet) for elevation, and a number of activities.
 */
export function toInput(metric: GoalMetric, target: number, imperial = false): { a: string; b?: string } {
  if (metric === 'time')
    return { a: String(Math.floor(target / 3600)), b: String(Math.round((target % 3600) / 60)) };
  if (metric === 'distance')
    return { a: String(Math.round((target / (imperial ? 1609.344 : 1000)) * 10) / 10) };
  if (metric === 'ascent') return { a: String(Math.round(imperial ? target * 3.28084 : target)) };
  return { a: String(Math.round(target)) };
}

export function fromInput(metric: GoalMetric, a: string, b = '', imperial = false): number {
  const n = (s: string) => Number(s.replace(',', '.')) || 0;
  if (metric === 'time') return n(a) * 3600 + n(b) * 60;
  if (metric === 'distance') return n(a) * (imperial ? 1609.344 : 1000);
  if (metric === 'ascent') return imperial ? n(a) / 3.28084 : n(a);
  return Math.round(n(a));
}
