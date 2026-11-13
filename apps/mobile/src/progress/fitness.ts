/**
 * Fitness on Progress, as Strava shows it (https://support.strava.com/es/articles/15401765-fitness): the
 * score is our CTL (42-day exponential average of the daily load, `packages/metrics`), over a month to
 * two years, and how much it changed from the first day of the range to the day picked.
 */

export type FitnessRange = '1m' | '3m' | '6m' | '1y' | '2y';

export const FITNESS_RANGES: FitnessRange[] = ['1m', '3m', '6m', '1y', '2y'];

const DAYS: Record<FitnessRange, number> = { '1m': 30, '3m': 90, '6m': 182, '1y': 365, '2y': 730 };

/** `YYYY-MM-DD` of a local date. */
export function isoDay(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** The days the range covers, as the API takes them: from its first day to tomorrow (excluded). */
export function rangePeriod(range: FitnessRange, today: Date): { from: string; to: string } {
  return { from: isoDay(addDays(today, -DAYS[range])), to: isoDay(addDays(today, 1)) };
}

export type Change = {
  /** Points gained (positive) or lost, rounded. */
  points: number;
  /** The same change as a share of the starting score, rounded; 0 when it started at nothing. */
  percent: number;
  direction: 'up' | 'down' | 'none';
};

/** From one score to another: Strava's "▼ 24 % −23 pt". */
export function fitnessChange(from: number, to: number): Change {
  const points = Math.round(to) - Math.round(from);
  const percent = from > 0 ? Math.round((Math.abs(to - from) / from) * 100) : 0;
  return { points, percent, direction: points > 0 ? 'up' : points < 0 ? 'down' : 'none' };
}

/** A circle's radius for a day's load, from 3 to 7 px: bigger circles, harder days. */
export function loadRadius(load: number, maxLoad: number): number {
  if (load <= 0 || maxLoad <= 0) return 0;
  return 3 + 4 * Math.sqrt(Math.min(1, load / maxLoad));
}

/** The 42 days of `packages/metrics`' CTL: each day without training takes 1/42 of it away. */
const CTL_DAYS = 42;

type Day = { day: string; load: number; ctl: number };

/**
 * The series up to today. The server rewrites it when an activity comes in, so after days without
 * training it stops at the last one: the missing days are added as the model has them, without load.
 */
export function untilToday<T extends Day>(days: T[], today: Date): T[] {
  const last = days.at(-1);
  if (!last) return days;
  const out = [...days];
  let ctl = last.ctl;
  const end = isoDay(today);
  for (let d = new Date(`${last.day}T12:00:00`); ;) {
    d = addDays(d, 1);
    const iso = isoDay(d);
    if (iso > end) break;
    ctl -= ctl / CTL_DAYS;
    out.push({ ...last, day: iso, load: 0, ctl });
  }
  return out;
}
