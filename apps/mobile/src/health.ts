/**
 * Turning Health Connect records into what `/api/wellness/health-connect` takes (OS-607). Pure, so it
 * is tested without the native module (health.test.ts).
 */

type Zone = { totalSeconds: number } | undefined;
type Meta = { id?: string; dataOrigin?: string } | undefined;

export type SleepRecord = {
  startTime: string;
  endTime: string;
  endZoneOffset?: Zone;
  stages?: { startTime: string; endTime: string; stage: number }[];
  metadata?: Meta;
};
export type Sample = { time: string; zoneOffset?: Zone };

export type Stage = 'awake' | 'light' | 'deep' | 'rem';
export type SleepUpload = {
  id: string;
  origin: string | null;
  start: string;
  end: string;
  utc_offset_s: number | null;
  stages: { start: string; end: string; stage: Stage }[];
};
export type DayUpload = {
  day: string;
  resting_hr?: number;
  hrv_ms?: number;
  spo2?: number;
  respiration?: number;
  steps?: number;
};

// Health Connect's SleepSessionRecord stages: 1 awake, 2 sleeping, 3 out of bed, 4 light, 5 deep,
// 6 REM, 7 awake in bed. "Sleeping" without detail counts as light; 0 (unknown) is left out.
const STAGES: Record<number, Stage> = {
  1: 'awake',
  2: 'light',
  3: 'awake',
  4: 'light',
  5: 'deep',
  6: 'rem',
  7: 'awake',
};

export function sleepUpload(record: SleepRecord): SleepUpload | null {
  const id = record.metadata?.id;
  if (!id) return null;
  return {
    id,
    origin: record.metadata?.dataOrigin ?? null,
    start: record.startTime,
    end: record.endTime,
    utc_offset_s: record.endZoneOffset?.totalSeconds ?? null,
    stages: (record.stages ?? []).flatMap((s) => {
      const stage = STAGES[s.stage];
      return stage ? [{ start: s.startTime, end: s.endTime, stage }] : [];
    }),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The local date a sample belongs to. Overnight measures (HRV, SpO₂, respiration) are shifted six
 * hours forward, so a reading at 23:30 counts for the morning the person woke up on.
 */
export function localDay(sample: Sample, overnight = false): string {
  const offset = sample.zoneOffset?.totalSeconds ?? -new Date(sample.time).getTimezoneOffset() * 60;
  const shifted = new Date(new Date(sample.time).getTime() + (offset + (overnight ? 6 * 3600 : 0)) * 1000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

type Field = Exclude<keyof DayUpload, 'day' | 'steps'>;

/** Averages per day of each kind of sample, merged into one row per day. */
export function dailyAverages(
  series: { field: Field; overnight: boolean; samples: (Sample & { value: number })[] }[],
  steps: { day: string; count: number }[] = [],
): DayUpload[] {
  const days = new Map<string, DayUpload>();
  const row = (day: string) => {
    let found = days.get(day);
    if (!found) days.set(day, (found = { day }));
    return found;
  };
  for (const { field, overnight, samples } of series) {
    const sums = new Map<string, [number, number]>();
    for (const s of samples) {
      if (!(s.value > 0)) continue;
      const day = localDay(s, overnight);
      const [total, n] = sums.get(day) ?? [0, 0];
      sums.set(day, [total + s.value, n + 1]);
    }
    for (const [day, [total, n]] of sums) row(day)[field] = Math.round((total / n) * 10) / 10;
  }
  for (const { day, count } of steps) if (count > 0) row(day).steps = Math.round(count);
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}
