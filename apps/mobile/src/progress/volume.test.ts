import { describe, expect, it } from 'vitest';

import {
  axisTicks,
  metricsFor,
  bucketValue,
  comparableYears,
  hoursMinutes,
  percentChange,
  rangeOf,
  sportsIn,
  yearsBack,
  type Bucket,
} from './volume';

const today = '2026-11-15'; // a Sunday

describe('rangeOf', () => {
  it('counts days for 7D and 1M, with the same span before', () => {
    expect(rangeOf('7d', today)).toEqual({
      unit: 'day',
      current: { from: '2026-11-09', to: '2026-11-16' },
      previous: { from: '2026-11-02', to: '2026-11-09' },
    });
    expect(rangeOf('1m', today).current.from).toBe('2026-10-16');
  });
  it('counts whole weeks for 3M, 6M and 1A, as Strava (24 ago, 1 jun, 17 nov)', () => {
    expect(rangeOf('3m', today).current.from).toBe('2026-08-24');
    expect(rangeOf('6m', today).current.from).toBe('2026-06-01');
    expect(rangeOf('1y', today).current.from).toBe('2025-11-17');
    expect(rangeOf('3m', today).previous).toEqual({ from: '2026-06-01', to: '2026-08-24' });
  });
  it('compares the year so far with last year up to the same date', () => {
    expect(rangeOf('ytd', today)).toMatchObject({
      current: { from: '2026-01-01', to: '2026-11-16' },
      previous: { from: '2025-01-01', to: '2025-11-16' },
    });
  });
});

describe('buckets', () => {
  const group = (s: string) => (s === 'trail_run' ? 'run' : s);
  const bucket: Bucket = {
    start: '2026-11-09',
    totals: { count: 3, distance_m: 30_000, moving_s: 9000, ascent_m: 500 },
    by_sport: {
      run: { count: 1, distance_m: 10_000, moving_s: 3000, ascent_m: 100 },
      trail_run: { count: 1, distance_m: 8000, moving_s: 3000, ascent_m: 400 },
      strength: { count: 1, distance_m: 0, moving_s: 3000, ascent_m: 0 },
    },
  };
  it('add up every sport or one group', () => {
    expect(bucketValue(bucket, 'time', null, group)).toBe(9000);
    expect(bucketValue(bucket, 'ascent', 'run', group)).toBe(500);
    expect(bucketValue(bucket, 'distance', 'ride', group)).toBe(0);
  });
  it('list their sport groups in order', () => {
    expect(sportsIn([bucket], ['run', 'ride', 'strength'], group)).toEqual(['run', 'strength']);
  });
});

describe('numbers', () => {
  it('compare with the previous range', () => {
    expect(percentChange(505, 100)).toBe(405);
    expect(percentChange(10, 0)).toBeNull();
    expect(percentChange(63, 100)).toBe(-37);
  });
  it('write hours and minutes', () => {
    expect(hoursMinutes(4 * 3600 + 17 * 60)).toBe('4h 17min');
    expect(hoursMinutes(0)).toBe('0h 0min');
    expect(hoursMinutes(1800)).toBe('30min');
  });
  it('round the axis to whole hours or kilometres', () => {
    expect(axisTicks(7.5 * 3600, 'time', 2)).toEqual([0, 4 * 3600, 8 * 3600]);
    expect(axisTicks(17_000, 'distance', 3)).toEqual([0, 6000, 12_000, 18_000]);
    expect(axisTicks(56_000, 'distance', 3)).toEqual([0, 20_000, 40_000, 60_000]);
    expect(axisTicks(4.3 * 3600, 'time', 3)).toEqual([0, 5400, 10_800, 16_200]); // 1h 30min steps
    expect(axisTicks(50 * 60, 'time', 2)).toEqual([0, 1800, 3600]);
  });
});

describe('comparing with years before', () => {
  const year = rangeOf('1y', today).current;
  it('moves back whole weeks, as Strava (18 nov 2024 for last year)', () => {
    expect(yearsBack(year, 1).from).toBe('2024-11-18');
    expect(yearsBack(year, 3).from).toBe('2022-11-21');
  });
  it('offers the years that reach the first activity', () => {
    expect(comparableYears(year, '2023-06-01')).toEqual([1, 2, 3]);
    expect(comparableYears(year, null)).toEqual([]);
  });
  it('counts activities too', () => {
    expect(axisTicks(14, 'count', 3)).toEqual([0, 5, 10, 15]);
  });
});

describe('metricsFor', () => {
  it('charts distance for sports that cover ground and time for the gym', () => {
    expect(metricsFor('run')[0]).toBe('distance');
    expect(metricsFor('strength')).toEqual(['time']);
    expect(metricsFor(null)[0]).toBe('time');
  });
});
