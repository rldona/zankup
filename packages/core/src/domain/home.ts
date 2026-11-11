/**
 * What Home shows (OS-527, OS-904), worked out from the feed and the health days, shared by the app and the
 * web: the last day with activities, the last seven days by sport, and health averages.
 */
import type { ActivitySummary, HealthDay } from '../api/queries';
import { localStart } from '../format';
import type { MessageKey } from '../i18n';
import type { Sport } from './sports';

/** "2026-11-09" for a date, in the device's time zone. */
export function isoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The day `n` days before `day` ("2026-11-09", 1 → "2026-11-08"). */
export function daysBefore(day: string, n: number): string {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number);
  return isoDay(new Date(y, m - 1, d - n));
}

/** The local day an activity happened on. */
export const activityDay = (a: ActivitySummary) => localStart(a.start_utc, a.timezone).slice(0, 10);

/** The most recent day with activities, and those activities (newest first). */
export function lastDay(items: ActivitySummary[]): { day: string; activities: ActivitySummary[] } | null {
  const first = items[0];
  if (!first) return null;
  const day = activityDay(first);
  return { day, activities: items.filter((a) => activityDay(a) === day) };
}

export type SportWeek = { sport: Sport; count: number; distance: number; moving: number };

/** The last seven days (today included), by sport, the busiest first. */
export function lastSevenDays(
  items: ActivitySummary[],
  today: string,
  asSport: (sport: string) => Sport,
): SportWeek[] {
  const from = daysBefore(today, 6);
  const by = new Map<Sport, SportWeek>();
  for (const a of items) {
    const day = activityDay(a);
    if (day < from || day > today) continue;
    const sport = asSport(a.sport);
    const row = by.get(sport) ?? { sport, count: 0, distance: 0, moving: 0 };
    row.count += 1;
    row.distance += a.distance_m ?? 0;
    row.moving += a.moving_s ?? a.duration_s;
    by.set(sport, row);
  }
  return [...by.values()].sort((a, b) => b.moving - a.moving);
}

type Metric = 'steps' | 'resting_hr' | 'hrv';

/** The average of a health metric over the days that have it, or null. */
export function healthAverage(days: HealthDay[], metric: Metric): number | null {
  const values = days.flatMap((d) => (d[metric] ? [d[metric].value] : []));
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

/** "Today", "Yesterday" or the date, for the last day's heading. */
export function dayHeading(day: string, today: string): 'today' | 'yesterday' | 'date' {
  if (day === today) return 'today';
  return day === daysBefore(today, 1) ? 'yesterday' : 'date';
}

/** The form (TSB) in words, as Stats, Home and the app name it. */
/**
 * This week's effort (Home): its moving time as a share of the average week of the previous twelve,
 * 100 % being an ordinary week. Null share when there is no history yet.
 */
export function weekEffort(week: { this_week: { moving_s: number }; previous: { moving_s: number }[] }): {
  share: number | null;
  average: number;
} {
  const average = week.previous.length
    ? week.previous.reduce((sum, w) => sum + w.moving_s, 0) / week.previous.length
    : 0;
  return { share: average > 0 ? Math.round((week.this_week.moving_s / average) * 100) : null, average };
}

/** How the form is coloured (pill and gauge): rested, neither, building (the training zone) or overreaching. */
export type FormTone = 'fresh' | 'neutral' | 'optimal' | 'overreaching';

export function formTone(tsb: number): FormTone {
  if (tsb > 5) return 'fresh';
  if (tsb > -10) return 'neutral';
  if (tsb > -30) return 'optimal';
  return 'overreaching';
}

/**
 * The training load's gauge on Home: freshness from -40 to +30, in the bands formTone draws (each
 * band's upper end), so the dot sits in the colour of the pill under it.
 */
export const FORM_GAUGE: { min: number; bands: { tone: FormTone; to: number }[] } = {
  min: -40,
  bands: [
    { tone: 'overreaching', to: -30 },
    { tone: 'optimal', to: -10 },
    { tone: 'neutral', to: 5 },
    { tone: 'fresh', to: 30 },
  ],
};

export function formLabel(tsb: number): MessageKey {
  if (tsb > 5) return 'stats.form.fresh';
  if (tsb > -10) return 'stats.form.neutral';
  if (tsb > -30) return 'stats.form.optimal';
  return 'stats.form.overreaching';
}
