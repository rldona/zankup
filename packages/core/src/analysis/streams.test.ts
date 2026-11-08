import { describe, expect, it } from 'vitest';

import {
  availableMetrics,
  fillGaps,
  metricValues,
  nearestIndex,
  quantile,
  sampleIndices,
  sectionStats,
  timeInZones,
  trackPoints,
  xAxis,
  zoneLimits,
  type Series,
} from './streams';

// Ten minutes at 3 m/s, one sample every 10 s, climbing 1 m per sample then dropping at the end.
const N = 61;
const RUN: Series = {
  t: Array.from({ length: N }, (_, i) => i * 10),
  dist: Array.from({ length: N }, (_, i) => i * 30),
  alt: Array.from({ length: N }, (_, i) => (i < 50 ? 100 + i : 149 - (i - 50) * 2)),
  hr: Array.from({ length: N }, (_, i) => (i < 30 ? 120 : 170)),
  lat: Array.from({ length: N }, (_, i) => (i === 5 ? null : 40 + i * 0.0001)),
  lon: Array.from({ length: N }, () => -3.7),
};

describe('stream analysis', () => {
  it('samples evenly and keeps both ends', () => {
    expect(sampleIndices(5, 10)).toEqual([0, 1, 2, 3, 4]);
    const kept = sampleIndices(1001, 5);
    expect(kept).toEqual([0, 250, 500, 750, 1000]);
  });

  it('fills gaps with the nearest known value', () => {
    expect(fillGaps([null, 2, null, 4])).toEqual([2, 2, 2, 4]);
    expect(fillGaps([null, null])).toBeNull();
  });

  it('derives a smooth speed from distance and time', () => {
    const speed = metricValues(RUN, 'speed') ?? [];
    expect(speed.every((v) => v != null && Math.abs(v - 3) < 1e-9)).toBe(true);
  });

  it('lists the metrics with data', () => {
    expect(availableMetrics(RUN)).toEqual(['speed', 'hr', 'alt']);
    expect(availableMetrics({ t: [0, 1], hr: [100, 110] })).toEqual(['hr']);
  });

  it('measures a section', () => {
    const s = sectionStats(RUN, 50, 0); // reversed on purpose
    expect(s.distance_m).toBe(1500);
    expect(s.time_s).toBe(500);
    expect(s.speed).toBe(3);
    expect(s.ascent_m).toBe(49);
    expect(s.descent_m).toBe(0);
    expect(s.avg_hr).toBe(Math.round((30 * 120 + 21 * 170) / 51));
    expect(sectionStats(RUN, 50, 60).descent_m).toBe(20);
  });

  it('finds the nearest sample on the x axis', () => {
    const { kind, values } = xAxis(RUN);
    expect(kind).toBe('dist');
    expect(nearestIndex(values, 44)).toBe(1);
    expect(nearestIndex(values, 46)).toBe(2);
    expect(nearestIndex(values, 99999)).toBe(N - 1);
    expect(xAxis({ t: [0, 5] }).kind).toBe('t');
  });

  it('adds up time in HR zones', () => {
    expect(zoneLimits(190)).toEqual([95, 114, 133, 152, 171]);
    const zones = timeInZones(RUN, 190);
    expect(zones).toEqual([0, 300, 0, 300, 0]); // 120 bpm is zone 2, 170 bpm is zone 4
    const paused = { t: [0, 10, 100], hr: [150, 150, 150] };
    expect(timeInZones(paused, 190)[2]).toBe(10); // the 90 s gap is not counted
  });

  it('gives quantiles and the track without missing points', () => {
    expect(quantile([5, null, 1, 3], 0)).toBe(1);
    expect(quantile([5, null, 1, 3], 1)).toBe(5);
    expect(quantile([null], 0.5)).toBeNull();
    const track = trackPoints(RUN);
    expect(track).toHaveLength(N - 1);
    expect(track[0]).toEqual({ index: 0, lonLat: [-3.7, 40] });
  });
});
