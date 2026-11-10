import { describe, expect, it } from 'vitest';

import { sleepBlocks, sleepDurationBand, sleepScoreBand, stageTotals, type StageSpan } from './sleep';

const night: StageSpan[] = [
  { offset_s: 0, duration_s: 600, stage: 'awake' },
  { offset_s: 600, duration_s: 1200, stage: 'light' },
  { offset_s: 1800, duration_s: 600, stage: 'light' },
  { offset_s: 2400, duration_s: 1800, stage: 'deep' },
  { offset_s: 4200, duration_s: 900, stage: 'rem' },
];

describe('sleepBlocks', () => {
  it('merges a stage that goes on, and says where each neighbour is', () => {
    expect(sleepBlocks(night)).toEqual([
      { start: 0, end: 600, lane: 0, from: null, to: 'below' },
      { start: 600, end: 2400, lane: 2, from: 'above', to: 'below' },
      { start: 2400, end: 4200, lane: 3, from: 'above', to: 'above' },
      { start: 4200, end: 5100, lane: 1, from: 'below', to: null },
    ]);
  });

  it('leaves a gap without a neighbour', () => {
    const gap = sleepBlocks([
      { offset_s: 0, duration_s: 600, stage: 'light' },
      { offset_s: 1800, duration_s: 600, stage: 'deep' },
    ]);
    expect(gap.map((b) => [b.from, b.to])).toEqual([
      [null, null],
      [null, null],
    ]);
  });
});

it('adds up each stage', () => {
  expect(stageTotals(night)).toEqual({ awake: 600, rem: 900, light: 1800, deep: 1800 });
});

it('bands the score and the hours', () => {
  expect([95, 81, 70, 40].map(sleepScoreBand)).toEqual(['excellent', 'good', 'fair', 'poor']);
  expect([7.5, 6.55, 5].map((h) => sleepDurationBand(h * 3600))).toEqual(['met', 'almost', 'short']);
});
