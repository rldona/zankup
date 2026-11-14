import { describe, expect, it } from 'vitest';

import { bestsIn, bestValue, placeOf, ranked, yearMedal, yearsOf } from './bests';

const b = (day: string, value: number, id = Math.round(value)) => ({ activity_id: id, day, value });

describe('best times', () => {
  const runs = [b('2019-08-09', 67), b('2025-11-10', 118), b('2026-08-21', 114), b('2026-10-17', 117)];
  it('ranks faster first for runs, more for power', () => {
    expect(ranked('400m', runs).map((x) => x.value)).toEqual([67, 114, 117, 118]);
    expect(ranked('power_30', [b('2026-01-01', 500), b('2026-02-01', 551)])[0].value).toBe(551);
    expect(placeOf('400m', runs, runs[2])).toBe(2);
  });
  it('gives the medal of the year', () => {
    expect(yearMedal('400m', runs, runs[2])).toBe(1);
    expect(yearMedal('400m', runs, runs[3])).toBe(2);
    expect(yearMedal('400m', runs, runs[0])).toBe(1);
  });
  it('lists the years and a year or the last twelve months, newest first', () => {
    expect(yearsOf(runs)).toEqual(['2026', '2025', '2019']);
    expect(bestsIn(runs, null, '2026-11-14').map((x) => x.day)).toEqual(['2026-10-17', '2026-08-21']);
    expect(bestsIn(runs, null, '2026-11-09')).toHaveLength(3); // 10 Nov 2025 is within twelve months
    expect(bestsIn(runs, '2019', '2026-11-14')).toHaveLength(1);
  });
  it('writes a measure as Strava does', () => {
    expect(bestValue('5k', 26 * 60 + 45, 'es')).toBe('26:45');
    expect(bestValue('marathon', 4 * 3600 + 6 * 60 + 10, 'es')).toBe('4:06:10');
    expect(bestValue('power_30', 551.4, 'es')).toBe('551 W');
    expect(bestValue('longest', 102200, 'es')).toBe('102,2 km');
  });
});
