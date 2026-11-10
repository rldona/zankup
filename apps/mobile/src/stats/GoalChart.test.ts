import { describe, expect, it, vi } from 'vitest';

vi.mock('@shopify/react-native-skia', () => ({}));
vi.mock('react-native', () => ({}));
vi.mock('../auth', () => ({}));
vi.mock('../theme', () => ({}));
vi.mock('../i18n', () => ({ locale: 'en', t: (k: string) => k }));

const { goalPoints } = await import('./GoalChart');

const day = (d: string, km: number[], sport = 'run', more: { sport: string; km: number }[] = []) => ({
  day: d,
  tsb: null,
  activities: [...km.map((k) => ({ sport, km: k })), ...more].map((a, i) => ({
    id: i,
    sport: a.sport,
    name: null,
    load: null,
    distance_m: a.km * 1000,
    moving_s: 600,
  })),
});

describe('goal chart', () => {
  const week = {
    metric: 'distance',
    sport: 'run',
    period: 'week',
    target: 21000,
    start: '2026-11-09',
    end: '2026-11-16',
  };

  it('cumulates the week, on track when at or above a steady pace, the rest still to come', () => {
    const points = goalPoints(
      week,
      [
        day('2026-11-09', [5]),
        day('2026-11-10', [], 'run'),
        day('2026-11-11', [10], 'run', [{ sport: 'ride', km: 50 }]),
      ],
      '2026-11-11',
    );
    expect(points).toHaveLength(7);
    expect(points.map((p) => p.done.toFixed(0))).toEqual([
      '5000',
      '5000',
      '15000',
      '15000',
      '15000',
      '15000',
      '15000',
    ]);
    expect(points.map((p) => p.state)).toEqual([
      'on',
      'behind',
      'on',
      'future',
      'future',
      'future',
      'future',
    ]);
  });

  it('counts a year by months', () => {
    const year = {
      ...week,
      metric: 'count',
      sport: null,
      period: 'year',
      target: 120,
      start: '2026-01-01',
      end: '2027-01-01',
    };
    const points = goalPoints(year, [day('2026-01-05', [1, 1]), day('2026-03-02', [1])], '2026-03-10');
    expect(points).toHaveLength(12);
    expect(points.slice(0, 3).map((p) => p.done)).toEqual([2, 2, 3]);
    expect(points.slice(0, 4).map((p) => p.state)).toEqual(['behind', 'behind', 'behind', 'future']);
  });
});
