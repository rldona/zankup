import { describe, expect, it } from 'vitest';

import { DURATIONS, levelAt, levelName, scaleAt, segments, skillLevel, strongest } from './skillLevels';

describe('skills', () => {
  it('has twelve spokes, sprint to climb', () => {
    expect(DURATIONS).toEqual([15, 30, 60, 120, 180, 300, 600, 900, 1200, 1800, 2700, 3600]);
  });
  it('reads the scale at the anchors and between them', () => {
    expect(scaleAt(60)).toEqual([4.5, 11.5]);
    expect(scaleAt(3600)).toEqual([1.8, 6.4]);
    const [lo, hi] = scaleAt(600);
    expect(lo).toBeGreaterThan(1.8);
    expect(lo).toBeLessThan(2.5);
    expect(hi).toBeLessThan(7.6);
  });
  it('places watts on nine levels by W/kg', () => {
    expect(levelAt(0, 60, 70)).toBe(0);
    expect(levelAt(4.5 * 70, 60, 70)).toBeCloseTo(1);
    expect(levelAt(11.5 * 70, 60, 70)).toBeCloseTo(9);
    expect(levelAt(2000, 60, 70)).toBe(9);
    expect(levelName(2.7)).toBe(2);
    expect(skillLevel([2, 3, 4])).toBe(3);
  });
  it('fills the bar segment by segment', () => {
    expect(segments(2.5).slice(0, 4)).toEqual([1, 1, 0.5, 0]);
  });
  it('finds the strongest skill and its best duration', () => {
    const bests = new Map([
      [600, 250],
      [300, 277],
      [120, 323],
      [180, 278],
      [15, 400],
    ]);
    const best = strongest(bests, 75);
    expect(best?.skill).toBe('attack');
    expect(best?.watts).toBeGreaterThan(0);
  });
});
