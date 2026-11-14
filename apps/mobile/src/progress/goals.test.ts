import { describe, expect, it } from 'vitest';

import { behind, chartPeriods, fraction, fromInput, left, runningTotal, toInput } from './goals';

const year = {
  period: 'year',
  metric: 'distance',
  target: 800_000,
  current: 602_700,
  start: '2026-01-01',
  end: '2027-01-01',
};

describe('a goal', () => {
  it('fills its ring and says what is left or extra', () => {
    expect(fraction(year)).toBeCloseTo(0.753, 3);
    expect(left(year)).toBe(197_300);
    expect(left({ ...year, current: 900_000 })).toBe(-100_000);
    expect(fraction({ ...year, current: 900_000 })).toBe(1);
  });
  it('is behind an even pace through the year', () => {
    // 15 Nov is day 319 of 365: an even pace would be at 699.2 km
    expect(behind(year, '2026-11-15') / 1000).toBeCloseTo(96.5, 1);
  });
});

describe('chartPeriods', () => {
  it('charts twelve weeks, twelve months or the year', () => {
    expect(chartPeriods('week', '2026-11-15')).toEqual({
      from: '2026-08-24',
      to: '2026-11-16',
      unit: 'week',
    });
    expect(chartPeriods('month', '2026-11-15').from).toBe('2025-12-01');
    expect(chartPeriods('year', '2026-11-15').from).toBe('2026-01-01');
  });
  it('adds up the year', () => {
    expect(runningTotal([1, 0, 2])).toEqual([1, 1, 3]);
  });
});

describe('the target typed', () => {
  it('goes both ways', () => {
    expect(fromInput('distance', '30')).toBe(30_000);
    expect(fromInput('distance', '12,5')).toBe(12_500);
    expect(fromInput('time', '1', '30')).toBe(5400);
    expect(fromInput('count', '3')).toBe(3);
    expect(toInput('time', 5400)).toEqual({ a: '1', b: '30' });
    expect(toInput('distance', 100_000)).toEqual({ a: '100' });
  });
});
