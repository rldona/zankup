import { describe, expect, it } from 'vitest';

import { activityBand, cumulative, effortStatus, weeklyRange } from './effort';

describe('weeklyRange', () => {
  it('is two thirds to four thirds of the three weeks before (Strava: 171-341)', () => {
    expect(weeklyRange([500, 250, 250, 268])).toEqual({ lo: 171, hi: 341 });
  });
  it('makes do with fewer weeks, and has none without effort', () => {
    expect(weeklyRange([300])).toEqual({ lo: 200, hi: 400 });
    expect(weeklyRange([])).toBeNull();
    expect(weeklyRange([0, 0, 0])).toBeNull();
  });
});

describe('effortStatus', () => {
  const range = { lo: 171, hi: 341 };
  it('places the week against its range', () => {
    expect(effortStatus(243, range)).toBe('in');
    expect(effortStatus(22, range)).toBe('below');
    expect(effortStatus(400, range)).toBe('above');
    expect(effortStatus(927, range)).toBe('far');
  });
  it('calls a week in range when there is nothing to compare with', () => {
    expect(effortStatus(100, null)).toBe('in');
  });
});

describe('cumulative', () => {
  it('adds up the week up to today', () => {
    expect(cumulative([60, 80, 0, 60, 43, 0, 0], 5)).toEqual([60, 140, 140, 200, 243, 243]);
    expect(cumulative([1, 2, 3])).toEqual([1, 3, 6]);
  });
});

describe('activityBand', () => {
  it('sorts activities by how hard they were', () => {
    expect(activityBand(14)).toBe('light');
    expect(activityBand(96)).toBe('moderate');
    expect(activityBand(182)).toBe('hard');
  });
});
