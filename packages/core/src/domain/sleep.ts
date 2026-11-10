/**
 * A night's stages laid out for the sleep card: one lane per stage (awake on top, deep at the bottom),
 * each stretch with the side it comes from or goes to squared off so the connectors meet it, and the
 * bands the score and the duration fall in. Pure, so it is tested without rendering (sleep.test.ts).
 */

export const SLEEP_LANES = ['awake', 'rem', 'light', 'deep'] as const;
export type SleepLane = (typeof SLEEP_LANES)[number];

export type StageSpan = { offset_s: number; duration_s: number; stage: SleepLane };

/** A stretch in one lane; `from`/`to` say where the stretch before and after sit (null: none touching). */
export type SleepBlock = {
  start: number;
  end: number;
  lane: number;
  from: 'above' | 'below' | null;
  to: 'above' | 'below' | null;
};

/** Consecutive spans of the same stage become one block; neighbours touch when there is no gap. */
export function sleepBlocks(spans: StageSpan[]): SleepBlock[] {
  const sorted = [...spans].sort((a, b) => a.offset_s - b.offset_s);
  const merged: { start: number; end: number; lane: number }[] = [];
  for (const s of sorted) {
    const lane = SLEEP_LANES.indexOf(s.stage);
    const last = merged.at(-1);
    if (last && last.lane === lane && s.offset_s - last.end <= 60) {
      last.end = Math.max(last.end, s.offset_s + s.duration_s);
    } else {
      merged.push({ start: s.offset_s, end: s.offset_s + s.duration_s, lane });
    }
  }
  const side = (here: number, other: { lane: number } | undefined, touching: boolean) =>
    other && touching ? (other.lane < here ? 'above' : 'below') : null;
  return merged.map((b, i) => {
    const prev = merged[i - 1];
    const next = merged[i + 1];
    return {
      ...b,
      from: side(b.lane, prev, !!prev && b.start - prev.end <= 60),
      to: side(b.lane, next, !!next && next.start - b.end <= 60),
    };
  });
}

/** Seconds spent in each stage, from the spans. */
export function stageTotals(spans: StageSpan[]): Record<SleepLane, number> {
  const out: Record<SleepLane, number> = { awake: 0, rem: 0, light: 0, deep: 0 };
  for (const s of spans) out[s.stage] += s.duration_s;
  return out;
}

export type SleepBand = 'excellent' | 'good' | 'fair' | 'poor';

/** The score's band, as Garmin and Fitbit name them: 90+, 80+, 60+, below. */
export function sleepScoreBand(score: number): SleepBand {
  return score >= 90 ? 'excellent' : score >= 80 ? 'good' : score >= 60 ? 'fair' : 'poor';
}

/** Hours asleep against the recommended seven: met, almost (six or more) or short. */
export const SLEEP_GOAL_S = 7 * 3600;
export function sleepDurationBand(asleep_s: number): 'met' | 'almost' | 'short' {
  return asleep_s >= SLEEP_GOAL_S ? 'met' : asleep_s >= SLEEP_GOAL_S - 3600 ? 'almost' : 'short';
}
