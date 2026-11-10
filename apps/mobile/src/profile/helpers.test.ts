import { describe, expect, it } from 'vitest';

import {
  ageOn,
  fromDayMonthYear,
  goalTarget,
  initials,
  toDayMonthYear,
  typeDayMonthYear,
  validDate,
} from './helpers';

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

  it('shows and reads a date as DD/MM/YYYY', () => {
    expect(toDayMonthYear('1982-08-14')).toBe('14/08/1982');
    expect(typeDayMonthYear('14081982')).toBe('14/08/1982');
    expect(typeDayMonthYear('140')).toBe('14/0');
    expect(fromDayMonthYear('14/08/1982')).toBe('1982-08-14');
    expect(fromDayMonthYear('4-8-1982')).toBe('1982-08-04');
    expect(fromDayMonthYear('30/02/1990')).toBeNull();
    expect(fromDayMonthYear('1982-08-14')).toBeNull();
  });
});
