import { describe, expect, it } from 'vitest';

import { change, monthGrid, shiftPeriod } from './dates';

describe('dates', () => {
  it('covers a month with whole weeks, Monday first', () => {
    expect(monthGrid(2026, 11)).toEqual(['2026-10-26', '2026-12-07']); // Nov 2026 starts on a Sunday
    expect(monthGrid(2026, 6)).toEqual(['2026-06-01', '2026-07-06']); // June 2026 starts on a Monday
  });

  it('moves between months and years', () => {
    expect(shiftPeriod('month', '2026-01', -1)).toBe('2025-12');
    expect(shiftPeriod('month', '2026-12', 1)).toBe('2027-01');
    expect(shiftPeriod('year', '2026', -1)).toBe('2025');
  });

  it('says how much something changed', () => {
    expect(change(110, 100)).toBe('+10 %');
    expect(change(90, 100)).toBe('-10 %');
    expect(change(5, 0)).toBeNull();
  });
});
