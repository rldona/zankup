/**
 * Volume on Progress (as Strava's Progress): time, distance or elevation per day or week over a range,
 * against the range before it, for every sport or one. Pure, so it is unit-tested; the totals come from
 * /api/stats/volume, whose weeks start on Monday like these.
 */
import { addDays, mondayOf } from './weeks';

export type ProgressRange = '7d' | '1m' | '3m' | '6m' | 'ytd' | '1y';
export const PROGRESS_RANGES: ProgressRange[] = ['7d', '1m', '3m', '6m', 'ytd', '1y'];

export type VolumeMetric = 'time' | 'distance' | 'ascent' | 'count';
export const VOLUME_METRICS: VolumeMetric[] = ['time', 'distance', 'ascent', 'count'];

export type Period = { from: string; to: string };

/** What a range covers (to excluded), in days or weeks, and the same span just before it. */
export function rangeOf(
  range: ProgressRange,
  today: string,
): { current: Period; previous: Period; unit: 'day' | 'week' } {
  const tomorrow = addDays(today, 1);
  if (range === '7d' || range === '1m') {
    const from = addDays(today, range === '7d' ? -6 : -30);
    const days = range === '7d' ? 7 : 31;
    return {
      unit: 'day',
      current: { from, to: tomorrow },
      previous: { from: addDays(from, -days), to: from },
    };
  }
  if (range === 'ytd') {
    const year = Number(today.slice(0, 4));
    const lastYear = `${year - 1}${today.slice(4)}`;
    return {
      unit: 'week',
      current: { from: `${year}-01-01`, to: tomorrow },
      previous: { from: `${year - 1}-01-01`, to: addDays(lastYear, 1) },
    };
  }
  const weeks = { '3m': 12, '6m': 24, '1y': 52 }[range];
  const from = addDays(mondayOf(today), -7 * (weeks - 1));
  return {
    unit: 'week',
    current: { from, to: tomorrow },
    previous: { from: addDays(from, -7 * weeks), to: from },
  };
}

export type Totals = { count: number; distance_m: number; moving_s: number; ascent_m: number };
export type Bucket = { start: string; totals: Totals; by_sport: Record<string, Totals> };

export function metricOf(t: Totals | undefined, metric: VolumeMetric): number {
  if (!t) return 0;
  if (metric === 'count') return t.count;
  return metric === 'time' ? t.moving_s : metric === 'distance' ? t.distance_m : t.ascent_m;
}

/** A bucket's value for every sport, or only for the activities whose group is `sport`. */
export function bucketValue(
  bucket: Bucket,
  metric: VolumeMetric,
  sport: string | null,
  groupOf: (sport: string) => string,
): number {
  if (!sport) return metricOf(bucket.totals, metric);
  return Object.entries(bucket.by_sport)
    .filter(([s]) => groupOf(s) === sport)
    .reduce((sum, [, t]) => sum + metricOf(t, metric), 0);
}

/** The sport groups found in some buckets, in the given order. */
export function sportsIn(
  buckets: Bucket[],
  order: readonly string[],
  groupOf: (s: string) => string,
): string[] {
  const found = new Set(buckets.flatMap((b) => Object.keys(b.by_sport).map(groupOf)));
  return order.filter((s) => found.has(s));
}

/** Rounded change from the previous range, or null when there was nothing to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** "4h 17min", "30min" or "0h 0min", as Strava writes totals and the time axis. */
export function hoursMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  return h || !minutes ? `${h}h ${minutes % 60}min` : `${minutes}min`;
}

/**
 * Ticks for the right axis, from zero: time in half hours or whole hours, distance in whole kilometres
 * (or miles: `unitSize` 1609.344 / 1000), elevation in metres (or feet) and activities in whole numbers.
 */
export function axisTicks(max: number, metric: VolumeMetric, intervals: number, unitSize = 1): number[] {
  if (metric === 'time') {
    const minutes = Math.max(30, max / 60);
    const step =
      [15, 30, 60, 90, 120, 180, 240, 300, 360, 480, 600, 720, 900, 1200, 1800, 2400].find(
        (s) => s * intervals >= minutes,
      ) ?? Math.ceil(minutes / intervals / 600) * 600;
    return Array.from({ length: intervals + 1 }, (_, i) => i * step * 60);
  }
  const unit = metric === 'distance' ? 1000 * unitSize : metric === 'count' ? 1 : unitSize;
  const top = Math.max(1, max / unit);
  const raw = top / intervals;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10]
      .map((m) => m * magnitude)
      .find((x) => x * intervals >= top && (metric !== 'count' || Number.isInteger(x))) ?? Math.ceil(raw);
  return Array.from({ length: intervals + 1 }, (_, i) => Math.round(i * step * unit * 1000) / 1000);
}

/**
 * What a sport is measured by, the first one charted: distance for those that cover ground, time for
 * the gym. Without a sport, time first. Activities only count in the detail screen.
 */
export function metricsFor(sport: string | null): VolumeMetric[] {
  switch (sport) {
    case null:
      return ['time', 'distance', 'ascent'];
    case 'strength':
      return ['time'];
    case 'run':
    case 'walk':
      return ['distance', 'time', 'ascent'];
    case 'ride':
      return ['distance', 'ascent', 'time'];
    case 'swim':
    case 'row':
      return ['distance', 'time'];
    default:
      return ['time', 'distance'];
  }
}

/** The same span `years` years back, in whole weeks (52 each), so its days fall on the same weekdays. */
export function yearsBack(period: Period, years: number): Period {
  return { from: addDays(period.from, -364 * years), to: addDays(period.to, -364 * years) };
}

/** How many years back can be compared: those that reach the first activity. */
export function comparableYears(
  period: Period,
  firstActivity: string | null | undefined,
  most = 15,
): number[] {
  if (!firstActivity) return [];
  const out: number[] = [];
  for (let k = 1; k <= most && yearsBack(period, k).to > firstActivity; k++) out.push(k);
  return out;
}
