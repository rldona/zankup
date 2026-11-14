/**
 * Race predictions on Progress (as Strava's): the engine's estimates `race_5k` … `race_marathon` (Riegel
 * from the best VDOT effort), their value on a past day from their history, and how they changed. Pure,
 * so it is unit-tested.
 */

export const RACES = [
  { kind: 'race_5k', metres: 5000, badge: '5' },
  { kind: 'race_10k', metres: 10000, badge: '10' },
  { kind: 'race_half_marathon', metres: 21097.5, badge: '21,1' },
  { kind: 'race_marathon', metres: 42195, badge: '42,2' },
] as const;

export type RaceKind = (typeof RACES)[number]['kind'];
export type Point = { day: string; value: number };

/** 24:54, or 2:01:35 past the hour. */
export function raceTime(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** 4:59 per kilometre (or mile). */
export function racePace(seconds: number, metres: number, imperial = false): string {
  const per = seconds / (metres / (imperial ? 1609.344 : 1000));
  const s = Math.round(per);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A change in time, short: 2s · 27s · 3min 46s · 1h 2min. */
export function changeText(seconds: number): string {
  const s = Math.round(Math.abs(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}min`;
}

/** The prediction on a day: the last change on or before it (the first one if it is older). */
export function valueOn(history: Point[], day: string): number | null {
  if (!history.length) return null;
  let value = history[0].value;
  for (const p of history) {
    if (p.day > day) break;
    value = p.value;
  }
  return value;
}

/**
 * The line for a range: the prediction on its first day, each change inside it and today's, so a
 * prediction that did not change is still a flat line across the range.
 */
export function series(history: Point[], from: string, today: string): Point[] {
  const start = valueOn(history, from);
  if (start == null) return [];
  const inside = history.filter((p) => p.day > from && p.day <= today);
  const out = [{ day: from, value: start }, ...inside];
  const last = out[out.length - 1];
  return last.day === today ? out : [...out, { day: today, value: last.value }];
}

/** Axis ticks for race times: round steps (10 s to 30 min) covering the range, at most `count`. */
export function timeTicks(lo: number, hi: number, count = 4): number[] {
  const span = Math.max(1, hi - lo);
  const step = [10, 15, 30, 60, 120, 180, 300, 600, 900, 1800].find((s) => span / s <= count) ?? 3600;
  const first = Math.floor(lo / step) * step;
  const out = [first];
  while (out[out.length - 1] < hi || out.length < 2) out.push(out[out.length - 1] + step);
  return out;
}
