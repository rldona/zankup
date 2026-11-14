/**
 * Training zones on Progress (as Strava's): the zone with the most time in a period, its share, how
 * that share changed against the span before, each zone's range and a sentence on the period. Pure, so
 * it is unit-tested; the seconds come from /api/stats/zones.
 */

export type ZoneKind = 'hr' | 'power';

/** The zone with the most time: its index (0 is Z1) and share (0 to 100); null without any time. */
export function topZone(seconds: number[]): { index: number; share: number } | null {
  const total = seconds.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const index = seconds.reduce((best, s, i) => (s > seconds[best] ? i : best), 0);
  return { index, share: Math.round((seconds[index] / total) * 100) };
}

/** How a zone's share moved against the span before, in points; null when there is nothing before. */
export function shareChange(seconds: number[], previous: number[], index: number): number | null {
  const total = previous.reduce((a, b) => a + b, 0);
  const now = seconds.reduce((a, b) => a + b, 0);
  if (total <= 0 || now <= 0) return null;
  return Math.round((seconds[index] / now) * 100 - (previous[index] / total) * 100);
}

/** A zone's range from the lower bounds: "<110", "111 - 150" or ">301", as Strava writes them. */
export function zoneRange(bounds: number[], index: number): string {
  if (!bounds.length) return '';
  const lo = bounds[index];
  const next = bounds[index + 1];
  if (index === 0 && lo <= 0) return `<${(next ?? 1) - 1}`;
  if (next == null) return `>${lo}`;
  return `${index === 0 ? lo : lo + 1} - ${next}`;
}

/**
 * The sentence under the zones: which zone moved most against the span before (its time, in %),
 * and whether that is easy, steady or hard work. Null when there is nothing to compare with.
 */
export function glance(
  seconds: number[],
  previous: number[],
): { zone: number; percent: number; up: boolean; band: 'easy' | 'steady' | 'hard' } | null {
  if (!previous.some((s) => s > 0) || !seconds.some((s) => s > 0)) return null;
  let zone = 0;
  let most = 0;
  seconds.forEach((s, i) => {
    const before = previous[i];
    if (before <= 0) return;
    const change = (s - before) / before;
    if (Math.abs(change) > Math.abs(most)) {
      most = change;
      zone = i;
    }
  });
  if (most === 0) return null;
  const count = seconds.length;
  const band = zone < 2 ? 'easy' : zone < Math.ceil(count / 2) ? 'steady' : 'hard';
  return { zone, percent: Math.round(Math.abs(most) * 100), up: most > 0, band };
}
