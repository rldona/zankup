import { describe, expect, it } from 'vitest';

import { buildTrack, colouredSegments, indexAt, rampExpression } from './track';

const track = buildTrack({
  t: [0, 10, 20, 30],
  dist: [0, 50, 100, 150],
  lat: [40, 40.001, null, 40.003],
  lon: [-3, -3.001, null, -3.003],
} as never);

describe('track', () => {
  it('colours pieces that join across GPS gaps, without a value where the metric is missing', () => {
    const { features } = colouredSegments(track, [1, 2, 3, null]);
    expect(features).toHaveLength(2);
    expect(features[0]?.properties).toEqual({ v: 2 });
    expect(features[1]?.properties).toEqual({});
    expect(features[1]?.geometry.coordinates).toEqual([
      [-3.001, 40.001],
      [-3.003, 40.003],
    ]);
  });

  it('keeps long routes to a few hundred pieces that share their ends', () => {
    const n = 5000;
    const long = buildTrack({
      t: Array.from({ length: n }, (_, i) => i),
      lat: Array.from({ length: n }, (_, i) => 40 + i / 1e4),
      lon: Array.from({ length: n }, () => -3),
    } as never);
    const { features } = colouredSegments(
      long,
      Array.from({ length: n }, (_, i) => i),
    );
    expect(features.length).toBeLessThanOrEqual(400);
    for (let k = 1; k < features.length; k++)
      expect(features[k]?.geometry.coordinates[0]).toEqual(features[k - 1]?.geometry.coordinates.at(-1));
  });

  it('spreads the ramp over the range, the fallback where there is no value', () => {
    const expression = rampExpression([100, 200], '#000', ['#a', '#b', '#c']) as unknown as unknown[];
    expect(expression[1]).toEqual(['has', 'v']);
    expect(expression[3]).toBe('#000');
    expect(expression[2]).toEqual(['interpolate', ['linear'], ['get', 'v'], 100, '#a', 150, '#b', 200, '#c']);
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
