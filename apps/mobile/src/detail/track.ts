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

/** At most this many pieces of line on the map: enough detail, little work for MapLibre. */
const MAX_PIECES = 400;

/**
 * The route as consecutive pieces, each a few samples long and carrying the mean value it is
 * coloured by (`v`, left out where the metric is missing: MapLibre on the phone cannot compare with
 * null). Pieces share their ends, so the line has no gaps, and are long enough that the map's
 * simplification never drops them.
 */
export function colouredSegments(
  track: Track,
  values: (number | null)[] | null | undefined,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const points: number[] = [];
  for (let i = 0; i < track.n; i++) if (track.lon[i] != null && track.lat[i] != null) points.push(i);
  const size = Math.max(1, Math.ceil((points.length - 1) / MAX_PIECES));
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  for (let start = 0; start < points.length - 1; start += size) {
    const piece = points.slice(start, Math.min(points.length, start + size + 1));
    let sum = 0;
    let count = 0;
    for (const i of piece.slice(1)) {
      const v = values?.[i];
      if (v != null) {
        sum += v;
        count++;
      }
    }
    features.push({
      type: 'Feature',
      properties: count ? { v: sum / count } : {},
      geometry: {
        type: 'LineString',
        coordinates: piece.map((i) => [track.lon[i] as number, track.lat[i] as number]),
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** The ramp's colours spread over `[lo, hi]`, the sport's colour where a piece has no value. */
export function rampExpression([lo, hi]: [number, number], fallback: string, ramp: readonly string[] = RAMP) {
  const step = (hi - lo) / (ramp.length - 1);
  return [
    'case',
    ['has', 'v'],
    ['interpolate', ['linear'], ['get', 'v'], ...ramp.flatMap((c, i) => [lo + i * step, c])],
    fallback,
  ] as unknown as string;
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
