/**
 * Weeks for Progress's Series and Training log (as Strava's): Monday-to-Sunday weeks counted back from
 * this one, what a day's bubble shows (time, distance or elevation) and how big it is, and each week's
 * place in the streak. Pure, so it is unit-tested.
 */
import { isoDay } from './fitness';

export type LogMetric = 'time' | 'distance' | 'ascent';

/** What a day's activities add up to, by the metric shown. */
export type DayActivity = {
  sport: string;
  moving_s: number;
  distance_m: number | null;
  ascent_m?: number | null;
};

const DAY = 86_400_000;

const at = (iso: string) => new Date(`${iso}T12:00:00`);

/** The Monday of the week a day is in. */
export function mondayOf(iso: string): string {
  const d = at(iso);
  return isoDay(new Date(d.getTime() - ((d.getDay() + 6) % 7) * DAY));
}

/** `n` days after a day (before, when negative). */
export function addDays(iso: string, n: number): string {
  const d = at(iso);
  return isoDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12));
}

/** The seven days of the week starting on `monday`. */
export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** How many weeks the log has: from the first activity's week to this one, both in. */
export function weekCount(firstActivity: string | null | undefined, today: string): number {
  if (!firstActivity) return 1;
  const days = (at(mondayOf(today)).getTime() - at(mondayOf(firstActivity)).getTime()) / DAY;
  return Math.max(1, Math.round(days / 7) + 1);
}

/** The Monday of the week `index` weeks back from this one (0 is this week). */
export function weekAt(index: number, today: string): string {
  return addDays(mondayOf(today), -7 * index);
}

/** Index of the week a day falls in, counted back from this week. */
export function indexOfWeek(iso: string, today: string): number {
  return Math.round((at(mondayOf(today)).getTime() - at(mondayOf(iso)).getTime()) / (7 * DAY));
}

/** "9 - 15 NOV" or, across months, "26 OCT - 1 NOV". */
export function weekRange(monday: string, locale: string): string {
  const sunday = addDays(monday, 6);
  const month = (iso: string) =>
    at(iso).toLocaleDateString(locale, { month: 'short' }).replace('.', '').toUpperCase();
  const day = (iso: string) => at(iso).getDate();
  return month(monday) === month(sunday)
    ? `${day(monday)} - ${day(sunday)} ${month(sunday)}`
    : `${day(monday)} ${month(monday)} - ${day(sunday)} ${month(sunday)}`;
}

export function valueOf(a: DayActivity, metric: LogMetric): number {
  if (metric === 'time') return a.moving_s;
  if (metric === 'distance') return a.distance_m ?? 0;
  return a.ascent_m ?? 0;
}

/** Where a bubble is as big as it gets: two hours, 40 km, 1000 m. */
const FULL: Record<LogMetric, number> = { time: 7200, distance: 40_000, ascent: 1000 };

/** A day's bubble, from 26 px (a few minutes) to `max` (`FULL` or more); 0 when there is nothing. */
export function bubbleSize(value: number, metric: LogMetric, max = 54): number {
  if (value <= 0) return 0;
  return Math.round(26 + (max - 26) * Math.sqrt(Math.min(1, value / FULL[metric])));
}

/** What a bubble says: 0:50 · 12,3 (km or mi) · 439 (m or ft). */
export function bubbleLabel(value: number, metric: LogMetric, locale: string, imperial = false): string {
  if (metric === 'time') {
    const minutes = Math.round(value / 60);
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
  }
  if (metric === 'distance') {
    const v = value / (imperial ? 1609.344 : 1000);
    return v.toLocaleString(locale, { maximumFractionDigits: v >= 100 ? 0 : 1 });
  }
  return Math.round(imperial ? value * 3.28084 : value).toLocaleString(locale);
}

/** A week's place in the Series column. */
export type WeekMark = 'streak' | 'current' | 'done' | 'missed' | 'future';

/**
 * The Series column: a week of the streak (ticked, on the band), this week when the streak reaches it
 * (the flame), another week with activity (ticked), a past week without (empty) or one still to come.
 */
export function weekMark(
  monday: string,
  today: string,
  active: boolean,
  streak: { since: string | null; weeks: number },
): WeekMark {
  const thisWeek = mondayOf(today);
  if (monday > thisWeek) return 'future';
  const inStreak = streak.since != null && streak.weeks > 0 && monday >= streak.since;
  if (monday === thisWeek) return inStreak ? 'current' : active ? 'done' : 'future';
  if (inStreak) return 'streak';
  return active ? 'done' : 'missed';
}
