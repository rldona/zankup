import { describe, expect, it } from 'vitest';

import { compare, comparisonYears } from './compare';

describe('compare', () => {
  it('gives the change and the bars, the larger one full', () => {
    expect(compare(258, 210)).toEqual({ percent: 23, now: 1, before: 210 / 258 });
    expect(compare(1978, 4037)).toEqual({ percent: -51, now: 1978 / 4037, before: 1 });
  });

  it('has no change without a year before, and empty bars without anything', () => {
    expect(compare(5, 0).percent).toBeNull();
    expect(compare(0, 0)).toEqual({ percent: null, now: 0, before: 0 });
  });

  it("names the period's year and the one before, from the range's exclusive end", () => {
    expect(comparisonYears({ to: '2027-01-01' })).toEqual([2025, 2026]); // the year 2026
    expect(comparisonYears({ to: '2026-11-12' })).toEqual([2025, 2026]); // the last 12 months
  });
});
