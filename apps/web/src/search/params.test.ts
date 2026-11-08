import { describe, expect, it } from 'vitest';

import { apiParams, periodRange } from './params';

const TODAY = new Date('2026-11-09T10:00:00');
const local = (day: string) => new Date(`${day}T00:00:00`).toISOString();

describe('search in the URL', () => {
  it('turns the URL into API filters in metres and seconds', () => {
    const url = new URLSearchParams('q=sierra&sport=run&sport=walk&dmin=5&tmax=60&hmin=140&gps=1&sort=speed');
    expect(apiParams(url, 'metric', TODAY)).toEqual({
      q: 'sierra',
      sport: ['run', 'walk'],
      min_distance: 5000,
      max_duration: 3600,
      min_hr: 140,
      with_gps: true,
      sort: 'speed',
    });
    expect(apiParams(new URLSearchParams('dmin=1'), 'imperial', TODAY).min_distance).toBeCloseTo(1609.344);
  });

  it('reads periods', () => {
    expect(periodRange(new URLSearchParams('period=year'), TODAY)).toEqual({ from: local('2026-01-01') });
    expect(periodRange(new URLSearchParams('period=2024'), TODAY)).toEqual({
      from: local('2024-01-01'),
      to: local('2025-01-01'),
    });
    expect(periodRange(new URLSearchParams('period=custom&from=2026-03-01&to=2026-03-31'), TODAY)).toEqual({
      from: local('2026-03-01'),
      to: local('2026-04-01'),
    });
    expect(periodRange(new URLSearchParams(''), TODAY)).toEqual({});
  });
});
