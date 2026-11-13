import { describe, expect, it } from 'vitest';

import { fitnessChange, isoDay, loadRadius, rangePeriod, untilToday } from './fitness';

describe('rangePeriod', () => {
  const today = new Date(2026, 10, 13);
  it('covers the range up to today, with tomorrow as the excluded end', () => {
    expect(rangePeriod('1m', today)).toEqual({ from: '2026-10-14', to: '2026-11-14' });
    expect(rangePeriod('2y', today).from).toBe('2024-11-13');
  });
  it('writes local days', () => {
    expect(isoDay(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('fitnessChange', () => {
  it('reads like Strava: 95 → 72 is 24 % and 23 points down', () => {
    expect(fitnessChange(95, 72)).toEqual({ points: -23, percent: 24, direction: 'down' });
  });
  it('goes up', () => {
    expect(fitnessChange(50, 60)).toEqual({ points: 10, percent: 20, direction: 'up' });
  });
  it('is "no change" when the rounded scores match, and never divides by zero', () => {
    expect(fitnessChange(72.2, 71.9).direction).toBe('none');
    expect(fitnessChange(0, 12)).toEqual({ points: 12, percent: 0, direction: 'up' });
  });
});

describe('loadRadius', () => {
  it('has no circle without load and grows up to 7 px', () => {
    expect(loadRadius(0, 100)).toBe(0);
    expect(loadRadius(100, 100)).toBe(7);
    expect(loadRadius(25, 100)).toBe(5);
  });
});

describe('untilToday', () => {
  const day = (d: string, ctl: number) => ({ day: d, load: 10, ctl });
  it('adds the days since the last one, fitness falling by 1/42 a day without load', () => {
    const out = untilToday([day('2026-11-12', 42)], new Date(2026, 10, 14));
    expect(out.map((d) => d.day)).toEqual(['2026-11-12', '2026-11-13', '2026-11-14']);
    expect(out[1]).toMatchObject({ load: 0, ctl: 41 });
    expect(out[2].ctl).toBeCloseTo(41 - 41 / 42);
  });
  it('leaves a series that already reaches today alone', () => {
    expect(untilToday([day('2026-11-14', 5)], new Date(2026, 10, 14))).toHaveLength(1);
  });
});
