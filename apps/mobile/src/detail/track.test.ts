import { describe, expect, it } from 'vitest';

import { buildTrack, gradientExpression, indexAt, rampColour } from './track';

const track = buildTrack({
  t: [0, 10, 20, 30],
  dist: [0, 50, 100, 150],
  lat: [40, 40.001, null, 40.003],
  lon: [-3, -3.001, null, -3.003],
} as never);

describe('track', () => {
  it('blends the ramp between its stops', () => {
    expect(rampColour(0, ['#000000', '#ffffff'])).toBe('#000000');
    expect(rampColour(0.5, ['#000000', '#ffffff'])).toBe('#808080');
    expect(rampColour(2, ['#000000', '#ff0000', '#ffffff'])).toBe('#ffffff');
  });

  it('colours the route along its length, the fallback where the metric is missing', () => {
    const expression = gradientExpression(track, [100, 200, 150, null], [100, 200], '#123456', [
      '#000000',
      '#ffffff',
    ]) as unknown[];
    expect(expression.slice(0, 3)).toEqual(['interpolate', ['linear'], ['line-progress']]);
    const stops = expression.slice(3);
    // The second point is a third of the way: the gap jumps twice as far.
    expect(stops.filter((_, k) => k % 2 === 1)).toEqual(['#000000', '#ffffff', '#123456']);
    expect(stops[0]).toBe(0);
    expect(stops[2] as number).toBeCloseTo(1 / 3, 2);
    expect(stops[4]).toBe(1);
  });

  it('keeps long routes to a few hundred rising stops', () => {
    const n = 5000;
    const long = buildTrack({
      t: Array.from({ length: n }, (_, i) => i),
      lat: Array.from({ length: n }, (_, i) => 40 + i / 1e4),
      lon: Array.from({ length: n }, () => -3),
    } as never);
    const stops = (
      gradientExpression(
        long,
        Array.from({ length: n }, (_, i) => i),
        [0, n],
        '#000',
      ) as unknown[]
    ).slice(3);
    expect(stops.length / 2).toBeLessThanOrEqual(240);
    for (let k = 2; k < stops.length; k += 2)
      expect(stops[k] as number).toBeGreaterThan(stops[k - 2] as number);
  });

  it('finds the sample at a time', () => {
    expect(indexAt([0, 10, 20, 30], 0)).toBe(0);
    expect(indexAt([0, 10, 20, 30], 19.9)).toBe(1);
    expect(indexAt([0, 10, 20, 30], 99)).toBe(3);
  });
});

describe('profile axis', () => {
  it('runs along time when the activity has no distance', () => {
    const strength = buildTrack({ t: [0, 60, 120], hr: [100, 120, 110] } as never);
    expect(strength.byTime).toBe(true);
    expect(strength.x).toEqual([0, 60, 120]);
    expect(strength.totalX).toBe(120);
    expect(track.byTime).toBe(false);
    expect(track.totalX).toBe(150);
  });
});
