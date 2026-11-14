import { describe, expect, it } from 'vitest';

import { glance, shareChange, topZone, zoneRange } from './zones';

describe('training zones', () => {
  const now = [50, 274, 1564, 4380, 333]; // Strava's: 1h 13min of 1h 50min in Z4
  it('finds the zone with most time and its share', () => {
    expect(topZone(now)).toEqual({ index: 3, share: 66 });
    expect(topZone([0, 0, 0])).toBeNull();
  });
  it('moves the share in points against the span before', () => {
    expect(shareChange(now, [100, 300, 1500, 4000, 400], 3)).toBe(3); // 66.4 % against 63.5 %
    expect(shareChange(now, [0, 0, 0, 0, 0], 3)).toBeNull();
  });
  it('writes the ranges as Strava does', () => {
    const power = [0, 110, 150, 180, 210, 240, 300];
    expect(zoneRange(power, 0)).toBe('<109');
    expect(zoneRange(power, 3)).toBe('181 - 210');
    expect(zoneRange(power, 6)).toBe('>300');
    expect(zoneRange([95, 114, 133, 152, 171], 0)).toBe('95 - 114');
    expect(zoneRange([], 2)).toBe('');
  });
  it('says which zone moved most, and how hard it is', () => {
    expect(glance([100, 100, 300, 100, 100], [100, 100, 200, 100, 100])).toEqual({
      zone: 2,
      percent: 50,
      up: true,
      band: 'steady',
    });
    expect(glance([500, 100], [1000, 100])?.band).toBe('easy');
    expect(glance(now, [0, 0, 0, 0, 0])).toBeNull();
  });
});
