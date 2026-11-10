/**
 * Streams → what the detail screen draws: plain typed arrays, so the gesture worklets on the UI thread
 * can read them without crossing to JS.
 */
import { RAMP, type ApiPaths } from '@zankup/core';

export type Streams =
  ApiPaths['/api/activities/{activity_id}/streams']['get']['responses'][200]['content']['application/json'];

export type Track = {
  n: number;
  t: number[]; // s from the start
  dist: number[]; // m, never null (carried forward)
  alt: (number | null)[];
  hr: (number | null)[];
  lon: (number | null)[];
  lat: (number | null)[];
  totalDist: number;
  /** What the profile runs along: distance, or time when the activity has none (strength, indoor). */
  x: number[];
  totalX: number;
  byTime: boolean;
  altMin: number;
  altMax: number;
  hrMin: number;
  hrMax: number;
  hasGps: boolean;
};

export function buildTrack(s: Streams): Track {
  const n = s.t.length;
  const dist: number[] = new Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const d = s.dist?.[i];
    if (d != null && d >= last) last = d;
    dist[i] = last;
  }
  const alt = s.alt ?? new Array<null>(n).fill(null);
  const hr = s.hr ?? new Array<null>(n).fill(null);
  const range = (values: (number | null)[]) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of values) {
      if (v == null) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return lo === Infinity ? [0, 1] : [lo, hi === lo ? lo + 1 : hi];
  };
  const [altMin, altMax] = range(alt);
  const [hrMin, hrMax] = range(hr);
  const byTime = (dist[n - 1] ?? 0) <= 0;
  const lat = s.lat ?? new Array<null>(n).fill(null);
  const lon = s.lon ?? new Array<null>(n).fill(null);
  return {
    n,
    t: s.t,
    dist,
    alt,
    hr,
    lat,
    lon,
    totalDist: dist[n - 1] ?? 0,
    x: byTime ? s.t : dist,
    totalX: (byTime ? s.t[n - 1] : dist[n - 1]) ?? 0,
    byTime,
    altMin,
    altMax,
    hrMin,
    hrMax,
    hasGps: lat.some((v) => v != null),
  };
}

/** Index of the first sample at or after `d` metres (binary search). Runs on the UI thread too. */
export function indexAtDistance(dist: number[], d: number): number {
  'worklet';
  let lo = 0;
  let hi = dist.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dist[mid] < d) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export type SectionStats = {
  distance: number;
  time: number;
  ascent: number;
  avgHr: number | null;
};

export function sectionStats(track: Track, from: number, to: number): SectionStats {
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(track.n - 1, Math.max(from, to));
  let ascent = 0;
  let hrSum = 0;
  let hrCount = 0;
  let prev: number | null = null;
  for (let i = a; i <= b; i++) {
    const v = track.alt[i];
    if (v != null) {
      if (prev != null && v > prev) ascent += v - prev;
      prev = v;
    }
    const h = track.hr[i];
    if (h != null) {
      hrSum += h;
      hrCount++;
    }
  }
  return {
    distance: track.dist[b] - track.dist[a],
    time: track.t[b] - track.t[a],
    ascent,
    avgHr: hrCount ? hrSum / hrCount : null,
  };
}

export function lineFeature(track: Track, from = 0, to = track.n - 1): GeoJSON.Feature<GeoJSON.LineString> {
  const coordinates: [number, number][] = [];
  for (let i = Math.max(0, from); i <= Math.min(to, track.n - 1); i++) {
    const lo = track.lon[i];
    const la = track.lat[i];
    if (lo != null && la != null) coordinates.push([lo, la]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } };
}

/** Nearest sample with a position, so the map cursor never disappears in a GPS gap. */
export function positionAt(track: Track, index: number): [number, number] | null {
  for (let k = 0; k < 120; k++) {
    for (const i of [index - k, index + k]) {
      const lo = track.lon[i];
      const la = track.lat[i];
      if (lo != null && la != null) return [lo, la];
    }
  }
  return null;
}

/** A colour on the ramp for a share from 0 to 1, blended between its two nearest stops. */
export function rampColour(share: number, ramp: readonly string[] = RAMP): string {
  const at = Math.min(Math.max(share, 0), 1) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(at));
  const f = at - i;
  const rgb = (hex: string) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  const a = rgb(ramp[i]);
  const b = rgb(ramp[i + 1]);
  return `#${a
    .map((v, k) =>
      Math.round(v + (b[k] - v) * f)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** At most this many colour stops along the line: smooth enough, and quick for MapLibre to restyle. */
const MAX_STOPS = 240;

/**
 * The route coloured by a metric as one `line-gradient` (over `line-progress`, the share of the
 * line's length), so switching the metric only restyles the line: its geometry is sent once.
 * Progress is measured on the same points `lineFeature` draws.
 */
export function gradientExpression(
  track: Track,
  values: (number | null)[],
  [lo, hi]: [number, number],
  fallback: string,
  ramp: readonly string[] = RAMP,
) {
  const points: number[] = [];
  for (let i = 0; i < track.n; i++) if (track.lon[i] != null && track.lat[i] != null) points.push(i);
  if (points.length < 2) return null;
  const along: number[] = [0];
  for (let k = 1; k < points.length; k++) {
    const p = points[k - 1];
    const q = points[k];
    const lat = (((track.lat[p] as number) + (track.lat[q] as number)) / 2) * (Math.PI / 180);
    const dx = ((track.lon[q] as number) - (track.lon[p] as number)) * Math.cos(lat);
    const dy = (track.lat[q] as number) - (track.lat[p] as number);
    along.push(along[k - 1] + Math.hypot(dx, dy));
  }
  const length = along[along.length - 1] || 1;
  const size = Math.max(1, Math.ceil(points.length / MAX_STOPS));
  const stops: (number | string)[] = [];
  let last = -1;
  for (let start = 0; start < points.length; start += size) {
    const end = Math.min(points.length, start + size);
    let sum = 0;
    let count = 0;
    for (let k = start; k < end; k++) {
      const v = values[points[k]];
      if (v != null) {
        sum += v;
        count++;
      }
    }
    const progress = along[Math.floor((start + end - 1) / 2)] / length;
    if (progress <= last) continue;
    last = progress;
    stops.push(progress, count ? rampColour((sum / count - lo) / (hi - lo || 1), ramp) : fallback);
  }
  if (stops.length < 4) return null;
  return ['interpolate', ['linear'], ['line-progress'], ...stops];
}

/** The sample at time `seconds` (the last one not after it). */
export function indexAt(times: number[], seconds: number): number {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((times[mid] ?? 0) <= seconds) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The range the axis covers: up to the highest value, so a real fast stretch is not cut off; only a
 * lone spike far above the rest (over 1.5 × the 98th percentile, a GPS glitch) is left out, and the
 * axis then stops at the 99.5th percentile. Values that hug zero start from the 2nd percentile.
 */
export function rangeOf(values: (number | null)[], fromZero: boolean): [number, number] {
  const sorted = values.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return [0, 1];
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
  const lo = fromZero ? 0 : at(0.02);
  const max = sorted[sorted.length - 1];
  const p98 = at(0.98);
  const hi = max <= Math.max(p98 * 1.5, p98 + 1) ? max : at(0.995);
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}
