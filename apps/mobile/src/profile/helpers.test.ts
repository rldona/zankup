import { describe, expect, it } from 'vitest';

import { ageOn, goalTarget, initials, validDate } from './helpers';

describe('profile helpers', () => {
  it('counts whole years up to the birthday', () => {
    expect(ageOn('1990-04-07', new Date(2026, 3, 6))).toBe(35);
    expect(ageOn('1990-04-07', new Date(2026, 3, 7))).toBe(36);
  });

  it('accepts only real dates', () => {
    expect(validDate('1990-04-07')).toBe(true);
    expect(validDate('1990-02-30')).toBe(false);
    expect(validDate('7/4/1990')).toBe(false);
  });

  it('saves goals in metres, seconds or a count', () => {
    expect(goalTarget('distance', 10, 'km')).toBe(10_000);
    expect(goalTarget('distance', 1, 'mi')).toBeCloseTo(1609.344);
    expect(goalTarget('time', 2, 'km')).toBe(7200);
    expect(goalTarget('count', 3, 'km')).toBe(3);
  });

  it('makes initials from the name or the email', () => {
    expect(initials({ display_name: 'Ana López', email: 'a@b.c' } as never)).toBe('AL');
    expect(initials({ display_name: null, email: 'raul@example.com' } as never)).toBe('RE');
  });
});
