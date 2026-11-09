import { describe, expect, it } from 'vitest';

import { dailyAverages, localDay, sleepUpload } from './health';

describe('Health Connect records', () => {
  it('a sleep keeps its id, origin, offset and the stages Zankup knows', () => {
    const upload = sleepUpload({
      startTime: '2026-11-07T22:30:00Z',
      endTime: '2026-11-08T06:30:00Z',
      endZoneOffset: { totalSeconds: 3600 },
      metadata: { id: 'abc', dataOrigin: 'com.google.android.apps.fitness' },
      stages: [
        { startTime: '2026-11-07T22:30:00Z', endTime: '2026-11-07T23:00:00Z', stage: 7 },
        { startTime: '2026-11-07T23:00:00Z', endTime: '2026-11-08T01:00:00Z', stage: 5 },
        { startTime: '2026-11-08T01:00:00Z', endTime: '2026-11-08T02:00:00Z', stage: 0 },
        { startTime: '2026-11-08T02:00:00Z', endTime: '2026-11-08T06:30:00Z', stage: 6 },
      ],
    });
    expect(upload).toMatchObject({
      id: 'abc',
      origin: 'com.google.android.apps.fitness',
      utc_offset_s: 3600,
    });
    expect(upload?.stages.map((s) => s.stage)).toEqual(['awake', 'deep', 'rem']);
    expect(sleepUpload({ startTime: 'a', endTime: 'b' })).toBeNull();
  });

  it('overnight readings count for the morning after', () => {
    const late = { time: '2026-11-07T22:30:00Z', zoneOffset: { totalSeconds: 3600 } };
    expect(localDay(late)).toBe('2026-11-07');
    expect(localDay(late, true)).toBe('2026-11-08');
  });

  it('averages each kind of sample per day and adds the steps', () => {
    const zone = { totalSeconds: 0 };
    const days = dailyAverages(
      [
        {
          field: 'hrv_ms',
          overnight: true,
          samples: [
            { time: '2026-11-08T02:00:00Z', zoneOffset: zone, value: 40 },
            { time: '2026-11-08T04:00:00Z', zoneOffset: zone, value: 51 },
          ],
        },
        {
          field: 'resting_hr',
          overnight: false,
          samples: [{ time: '2026-11-08T12:00:00Z', zoneOffset: zone, value: 52 }],
        },
      ],
      [{ day: '2026-11-07', count: 8000 }],
    );
    expect(days).toEqual([
      { day: '2026-11-07', steps: 8000 },
      { day: '2026-11-08', hrv_ms: 45.5, resting_hr: 52 },
    ]);
  });
});
