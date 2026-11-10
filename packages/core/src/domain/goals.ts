/**
 * A goal day by day (OS-527, OS-911): what each day of a weekly goal added (each day of a month, each
 * month of a year), cumulated, against a steady pace towards the target. Worked out from the calendar
 * the Stats screen already reads; shared by the app's chart (Skia) and the web's (SVG).
 */
import type { CalendarDay, GoalOut } from '../api/queries';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (day: string) => new Date(`${day}T00:00:00Z`);

export type GoalPoint = {
  label: string;
  /** The point's day (or month) written out, for the value above the chart. */
  when: string;
  /** What was done from the start of the period to the end of this point. */
  done: number;
  /** What was done in this point alone (the day, or the month of a yearly goal). */
  own: number;
  /** Where a steady pace would be by then. */
  expected: number;
  state: 'on' | 'behind' | 'future';
};

/** How much one calendar day counts towards the goal (its sport, its metric). */
export function dayAmount(goal: Pick<GoalOut, 'metric' | 'sport'>, day: CalendarDay): number {
  return day.activities
    .filter((a) => !goal.sport || a.sport === goal.sport)
    .reduce(
      (sum, a) =>
        sum + (goal.metric === 'distance' ? (a.distance_m ?? 0) : goal.metric === 'time' ? a.moving_s : 1),
      0,
    );
}

/** The points of the chart: days of a week or a month, months of a year, cumulated. */
export function goalPoints(
  goal: Pick<GoalOut, 'metric' | 'sport' | 'period' | 'target' | 'start' | 'end'>,
  days: CalendarDay[],
  today: string,
  locale: string,
): GoalPoint[] {
  const start = parse(goal.start);
  const end = parse(goal.end);
  const length = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const byDay = new Map(days.map((d) => [d.day, dayAmount(goal, d)]));
  // Each point closes at the end of a day (week, month) or of a month (year).
  const closes: { last: Date; label: string; when: string }[] = [];
  if (goal.period === 'year') {
    for (let m = 0; m < 12; m++) {
      const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m + 1, 0));
      closes.push({
        last,
        label: last.toLocaleDateString(locale, { month: 'narrow', timeZone: 'UTC' }),
        when: last.toLocaleDateString(locale, { month: 'long', timeZone: 'UTC' }),
      });
    }
  } else {
    for (let i = 0; i < length; i++) {
      const day = new Date(start.getTime() + i * 86_400_000);
      closes.push({
        last: day,
        label:
          goal.period === 'week'
            ? day.toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' }).replace('.', '')
            : String(day.getUTCDate()),
        when: day.toLocaleDateString(locale, {
          weekday: 'long',
          day: 'numeric',
          month: 'short',
          timeZone: 'UTC',
        }),
      });
    }
  }
  let done = 0;
  let cursor = new Date(start);
  return closes.map(({ last, label, when }) => {
    let own = 0;
    for (; cursor <= last; cursor = new Date(cursor.getTime() + 86_400_000))
      own += byDay.get(iso(cursor)) ?? 0;
    done += own;
    const elapsed = Math.round((last.getTime() - start.getTime()) / 86_400_000) + 1;
    const expected = (goal.target * elapsed) / length;
    // A day after today is still to come; so is a month of a yearly goal that has not begun.
    const future = goal.period === 'year' ? iso(last).slice(0, 7) > today.slice(0, 7) : iso(last) > today;
    const state: GoalPoint['state'] = future ? 'future' : done >= expected ? 'on' : 'behind';
    return { label, when, done, own, expected, state };
  });
}

/** A goal's target as typed in its form: km (or mi), hours or sessions. */
export function goalInput(metric: 'distance' | 'time' | 'count', target: number, unit: string): number {
  if (metric === 'distance') return target / (unit === 'km' ? 1000 : 1609.344);
  return metric === 'time' ? target / 3600 : target;
}

/** What is typed in the form, as the API stores it: metres, seconds or sessions. */
export function goalTarget(metric: 'distance' | 'time' | 'count', value: number, unit: string): number {
  if (metric === 'distance') return value * (unit === 'km' ? 1000 : 1609.344);
  return metric === 'time' ? value * 3600 : value;
}
