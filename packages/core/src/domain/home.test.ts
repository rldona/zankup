import { describe, expect, it } from 'vitest';
import type { ActivitySummary, HealthDay } from '../api/queries';
import { dayHeading, daysBefore, healthAverage as average, lastDay, lastSevenDays } from './home';

const activity = (id: number, start: string, sport: string, distance: number | null, moving = 3600) =>
  ({
    id,
    start_utc: start,
    timezone: '+01:00',
    sport,
    distance_m: distance,
    moving_s: moving,
    duration_s: moving,
  }) as ActivitySummary;

const items = [
  activity(4, '2026-11-09T17:24:00Z', 'strength', null, 2400),
  activity(3, '2026-11-09T11:31:00Z', 'ride', 11_860, 5217),
  activity(2, '2026-11-07T10:16:00Z', 'ride', 12_250, 3567),
  activity(1, '2026-10-30T17:09:00Z', 'strength', null, 2145),
];
const asSport = (s: string) => s as never;

describe('home', () => {
  it('finds the last day with activities', () => {
    expect(lastDay(items)).toEqual({ day: '2026-11-09', activities: [items[0], items[1]] });
    expect(lastDay([])).toBeNull();
  });

  it('sums the last seven days by sport, the busiest first', () => {
    const week = lastSevenDays(items, '2026-11-10', asSport);
    expect(week.map((w) => [w.sport, w.count, w.distance])).toEqual([
      ['ride', 2, 24_110],
      ['strength', 1, 0],
    ]);
  });

  it('averages a health metric over the days that have it', () => {
    const days = [
      { steps: { value: 2000 } },
      { steps: null },
      { steps: { value: 3000 } },
    ] as unknown as HealthDay[];
    expect(average(days, 'steps')).toBe(2500);
    expect(average(days, 'hrv')).toBeNull();
  });

  it('names the day', () => {
    expect(daysBefore('2026-03-01', 1)).toBe('2026-02-28');
    expect(dayHeading('2026-11-10', '2026-11-10')).toBe('today');
    expect(dayHeading('2026-11-09', '2026-11-10')).toBe('yesterday');
    expect(dayHeading('2026-11-07', '2026-11-10')).toBe('date');
  });
});
