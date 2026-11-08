/**
 * Analysis of an activity's series for the detail screen (OS-206, OS-207, OS-208, OS-216): the
 * figures behind the profile chart, the coloured map, the selected section and the HR zones. Pure
 * functions over the API's columnar series (SI units, null for missing samples), shared with the app.
 */

export interface Series {
  t: number[];
  lat?: (number | null)[] | null;
  lon?: (number | null)[] | null;
  dist?: (number | null)[] | null;
  alt?: (number | null)[] | null;
  hr?: (number | null)[] | null;
  cad?: (number | null)[] | null;
  speed?: (number | null)[] | null;
  power?: (number | null)[] | null;
  temp?: (number | null)[] | null;
}

/** What the map and the chart can be coloured by. */
export type Metric = 'speed' | 'hr' | 'power' | 'alt';

/** Keeps at most `max` samples, evenly spaced, always including the first and the last. */
export function sampleIndices(length: number, max: number): number[] {
  if (length <= max) return Array.from({ length }, (_, i) => i);
  const step = (length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => Math.round(i * step));
}

/** Last known value carried forward and back, so a gap does not break a line or a sum. */
export function fillGaps(values: (number | null | undefined)[]): number[] | null {
  const first = values.find((v) => v != null);
  if (first == null) return null;
  let last = first;
  return values.map((v) => (v == null ? last : (last = v)));
}

/**
 * Speed in m/s averaged over ±`seconds` around each sample, from distance and time (what the watch
 * shows second by second is too jumpy for a chart). Falls back to the recorded speed series when there
 * is no distance.
 */
export function smoothSpeed(series: Series, seconds = 15): (number | null)[] | null {
  const dist = series.dist ? fillGaps(series.dist) : null;
  if (!dist) return series.speed ?? null;
  const { t } = series;
  let a = 0;
  let b = 0;
  return t.map((now) => {
    while (a < t.length - 1 && (t[a] ?? 0) < now - seconds) a++;
    while (b < t.length - 1 && (t[b + 1] ?? 0) <= now + seconds) b++;
    const dt = (t[b] ?? 0) - (t[a] ?? 0);
    return dt > 0 ? ((dist[b] ?? 0) - (dist[a] ?? 0)) / dt : null;
  });
}

/** Moving average over ±`window` samples, ignoring missing values (for power, which is spiky). */
export function smooth(values: (number | null)[], window = 2): (number | null)[] {
  return values.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - window); j <= Math.min(values.length - 1, i + window); j++) {
      const v = values[j];
      if (v != null) {
        sum += v;
        count++;
      }
    }
    return count ? sum / count : null;
  });
}

/** The series for a metric, ready to plot. Null when the activity has no data for it. */
export function metricValues(series: Series, metric: Metric): (number | null)[] | null {
  const has = (values: (number | null)[] | null | undefined) => values?.some((v) => v != null);
  switch (metric) {
    case 'speed':
      return smoothSpeed(series);
    case 'hr':
      return has(series.hr) ? (series.hr ?? null) : null;
    case 'power':
      return has(series.power) ? smooth(series.power ?? []) : null;
    case 'alt':
      return has(series.alt) ? (series.alt ?? null) : null;
  }
}

/** The metrics this activity has data for, in the order the switch shows them. */
export function availableMetrics(series: Series): Metric[] {
  return (['speed', 'hr', 'power', 'alt'] as const).filter((m) => {
    const values = metricValues(series, m);
    return values?.some((v) => v != null && v > 0) ?? false;
  });
}

/** The value below which a fraction `q` of the samples fall (missing samples ignored). */
export function quantile(values: (number | null)[], q: number): number | null {
  const sorted = values.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))] ?? null;
}

/** The x axis of the profile: distance in metres when there is any, otherwise time in seconds. */
export function xAxis(series: Series): { kind: 'dist' | 't'; values: number[] } {
  const dist = series.dist ? fillGaps(series.dist) : null;
  if (dist && (dist.at(-1) ?? 0) > 0) return { kind: 'dist', values: dist };
  return { kind: 't', values: series.t };
}

/** Index of the sample whose x is closest to `x` (x values never decrease). */
export function nearestIndex(xs: number[], x: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((xs[mid] ?? 0) < x) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs((xs[lo - 1] ?? 0) - x) <= Math.abs((xs[lo] ?? 0) - x)) return lo - 1;
  return lo;
}

export interface SectionStats {
  distance_m: number | null;
  time_s: number;
  speed: number | null; // m/s
  avg_hr: number | null;
  avg_power: number | null;
  ascent_m: number | null;
  descent_m: number | null;
}

/** Figures of the samples from `from` to `to` (inclusive): the selected section of the profile. */
export function sectionStats(series: Series, from: number, to: number): SectionStats {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const time = (series.t[b] ?? 0) - (series.t[a] ?? 0);
  const dist = series.dist ? fillGaps(series.dist) : null;
  const distance = dist ? (dist[b] ?? 0) - (dist[a] ?? 0) : null;
  const mean = (values: (number | null)[] | null | undefined) => {
    if (!values) return null;
    let sum = 0;
    let count = 0;
    for (let i = a; i <= b; i++) {
      const v = values[i];
      if (v != null) {
        sum += v;
        count++;
      }
    }
    return count ? sum / count : null;
  };
  let ascent: number | null = null;
  let descent: number | null = null;
  const alt = series.alt ? fillGaps(series.alt) : null;
  if (alt) {
    ascent = 0;
    descent = 0;
    for (let i = a + 1; i <= b; i++) {
      const step = (alt[i] ?? 0) - (alt[i - 1] ?? 0);
      if (step > 0) ascent += step;
      else descent -= step;
    }
  }
  const avgHr = mean(series.hr);
  const avgPower = mean(series.power);
  return {
    distance_m: distance,
    time_s: time,
    speed: distance != null && time > 0 ? distance / time : null,
    avg_hr: avgHr == null ? null : Math.round(avgHr),
    avg_power: avgPower == null ? null : Math.round(avgPower),
    ascent_m: ascent == null ? null : Math.round(ascent),
    descent_m: descent == null ? null : Math.round(descent),
  };
}

/** Lower bounds of the five HR zones as a share of max HR (the prototype's model: 50/60/70/80/90 %). */
export const ZONE_SHARES = [0.5, 0.6, 0.7, 0.8, 0.9] as const;

export function zoneLimits(hrMax: number, shares: readonly number[] = ZONE_SHARES): number[] {
  return shares.map((s) => Math.round(s * hrMax));
}

/**
 * Seconds spent in each of the five zones. Each sample counts for the time until the next one (gaps
 * over 30 s, like a paused watch, are not counted). Time below zone 1 is left out.
 */
export function timeInZones(
  series: Series,
  hrMax: number,
  shares: readonly number[] = ZONE_SHARES,
): number[] {
  const limits = zoneLimits(hrMax, shares);
  const zones = [0, 0, 0, 0, 0];
  const { t, hr } = series;
  if (!hr) return zones;
  for (let i = 0; i < t.length - 1; i++) {
    const v = hr[i];
    const dt = (t[i + 1] ?? 0) - (t[i] ?? 0);
    if (v == null || dt <= 0 || dt > 30) continue;
    let zone = -1;
    for (let z = limits.length - 1; z >= 0; z--) {
      if (v >= (limits[z] ?? Infinity)) {
        zone = z;
        break;
      }
    }
    if (zone >= 0) zones[zone] = (zones[zone] ?? 0) + dt;
  }
  return zones;
}

/** Points of the track with both coordinates, as [lon, lat] for GeoJSON, with their sample index. */
export function trackPoints(series: Series): { index: number; lonLat: [number, number] }[] {
  const { lat, lon } = series;
  if (!lat || !lon) return [];
  const points: { index: number; lonLat: [number, number] }[] = [];
  for (let i = 0; i < lat.length; i++) {
    const y = lat[i];
    const x = lon[i];
    if (y != null && x != null) points.push({ index: i, lonLat: [x, y] });
  }
  return points;
}
