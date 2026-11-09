/**
 * Health Connect on the phone (OS-607): a local alternative to Google's API. The app asks for read
 * permissions only (sleep, resting HR, HRV, SpO₂, respiratory rate, steps), reads what is new since
 * the last time (with two days of overlap, since a night's data can arrive late) and sends it to the
 * instance, which keeps it as the `health_connect` source and dedupes it against the others (OS-605).
 *
 * It runs when the person taps the button and, once permitted, each time the app opens (at most once
 * an hour). Nothing is written to Health Connect.
 */
import type { ApiClient } from '@zankup/core';
import {
  aggregateGroupByPeriod,
  getGrantedPermissions,
  getSdkStatus,
  initialize,
  readRecords,
  requestPermission,
  SdkAvailabilityStatus,
  type Permission,
  type RecordResult,
  type RecordType,
} from 'react-native-health-connect';

import { dailyAverages, sleepUpload, type DayUpload, type SleepUpload } from './health';
import { readSync, storage } from './storage';

const LAST = 'zankup.healthConnect.last';
const FIRST_DAYS = 30;
const OVERLAP_MS = 2 * 86_400_000;
const EVERY_MS = 3_600_000;
const TYPES = [
  'SleepSession',
  'RestingHeartRate',
  'HeartRateVariabilityRmssd',
  'OxygenSaturation',
  'RespiratoryRate',
  'Steps',
] as const satisfies readonly RecordType[];
const PERMISSIONS: Permission[] = TYPES.map((recordType) => ({ accessType: 'read', recordType }));

export async function available(): Promise<boolean> {
  try {
    return (await getSdkStatus()) === SdkAvailabilityStatus.SDK_AVAILABLE && (await initialize());
  } catch {
    return false;
  }
}

async function granted(): Promise<Set<string>> {
  const list = await getGrantedPermissions();
  return new Set(list.filter((p) => p.accessType === 'read').map((p) => p.recordType));
}

/** Shows Health Connect's permission screen; true if at least one type was allowed. */
export async function ask(): Promise<boolean> {
  if (!(await available())) return false;
  const answer = await requestPermission(PERMISSIONS);
  return answer.some((p) => p.accessType === 'read');
}

export function lastRead(): string | null {
  return readSync(LAST);
}

async function all<T extends RecordType>(type: T, startTime: string, endTime: string) {
  const out = [];
  let pageToken: string | undefined;
  do {
    const page = await readRecords(type, {
      timeRangeFilter: { operator: 'between', startTime, endTime },
      pageSize: 1000,
      pageToken,
    });
    out.push(...page.records);
    pageToken = page.pageToken || undefined;
  } while (pageToken);
  return out;
}

export type ReadResult = { nights: number; days: number };

/** Reads from Health Connect and sends it to the instance. `force` ignores the hourly limit. */
export async function readAndSend(api: ApiClient, force = false): Promise<ReadResult | null> {
  if (!(await available())) return null;
  const allowed = await granted();
  if (allowed.size === 0) return null;
  const last = lastRead();
  if (!force && last && Date.now() - new Date(last).getTime() < EVERY_MS) return null;
  const now = new Date();
  const start = new Date(
    last ? new Date(last).getTime() - OVERLAP_MS : now.getTime() - FIRST_DAYS * 86_400_000,
  );
  const [from, to] = [start.toISOString(), now.toISOString()];
  // Steps are summed per local day: start at midnight, or the first day would be a partial count.
  const midnight = new Date(start);
  midnight.setHours(0, 0, 0, 0);

  const sleep: SleepUpload[] = allowed.has('SleepSession')
    ? (await all('SleepSession', from, to)).map(sleepUpload).filter((s): s is SleepUpload => s !== null)
    : [];
  const samples = async <T extends RecordType>(type: T, value: (r: RecordResult<T>) => number) =>
    allowed.has(type)
      ? (await all(type, from, to)).map((r) => {
          const sample = r as unknown as { time: string; zoneOffset?: { totalSeconds: number } };
          return { time: sample.time, zoneOffset: sample.zoneOffset, value: value(r) };
        })
      : [];
  const steps = allowed.has('Steps')
    ? (
        await aggregateGroupByPeriod({
          recordType: 'Steps',
          timeRangeFilter: { operator: 'between', startTime: midnight.toISOString(), endTime: to },
          timeRangeSlicer: { period: 'DAYS', length: 1 },
        })
      ).map((g) => ({ day: g.startTime.slice(0, 10), count: g.result.COUNT_TOTAL })) // local date-times
    : [];
  const days: DayUpload[] = dailyAverages(
    [
      {
        field: 'resting_hr',
        overnight: false,
        samples: await samples('RestingHeartRate', (r) => r.beatsPerMinute),
      },
      {
        field: 'hrv_ms',
        overnight: true,
        samples: await samples('HeartRateVariabilityRmssd', (r) => r.heartRateVariabilityMillis),
      },
      { field: 'spo2', overnight: true, samples: await samples('OxygenSaturation', (r) => r.percentage) },
      { field: 'respiration', overnight: true, samples: await samples('RespiratoryRate', (r) => r.rate) },
    ],
    steps,
  );

  for (let i = 0; i < Math.max(sleep.length, days.length, 1); i += 200) {
    const { error } = await api.POST('/api/wellness/health-connect', {
      body: { sleep: sleep.slice(i, i + 200), days: days.slice(i, i + 200) },
    });
    if (error) throw new Error('upload');
  }
  await storage.setItem(LAST, now.toISOString());
  return { nights: sleep.length, days: days.length };
}
