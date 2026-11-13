import { describe, expect, it } from 'vitest';

import {
  addDays,
  bubbleLabel,
  bubbleSize,
  indexOfWeek,
  mondayOf,
  valueOf,
  weekAt,
  weekCount,
  weekDays,
  weekMark,
  weekRange,
} from './weeks';

const today = '2026-11-14'; // a Saturday

describe('weeks', () => {
  it('start on Monday', () => {
    expect(mondayOf(today)).toBe('2026-11-09');
    expect(mondayOf('2026-11-09')).toBe('2026-11-09');
    expect(mondayOf('2026-11-15')).toBe('2026-11-09');
    expect(weekDays('2026-10-26').at(-1)).toBe('2026-11-01');
  });
  it('are counted back from this one', () => {
    expect(weekAt(0, today)).toBe('2026-11-09');
    expect(weekAt(2, today)).toBe('2026-10-26');
    expect(indexOfWeek('2026-10-28', today)).toBe(2);
    expect(weekCount('2026-10-28', today)).toBe(3);
    expect(weekCount(null, today)).toBe(1);
  });
  it('cross daylight saving without drifting', () => {
    expect(addDays('2026-10-24', 7)).toBe('2026-10-31');
    expect(weekAt(3, today)).toBe('2026-10-19');
  });
  it('are written as Strava does', () => {
    expect(weekRange('2026-11-09', 'es')).toBe('9 - 15 NOV');
    expect(weekRange('2026-10-26', 'es')).toBe('26 OCT - 1 NOV');
  });
});

describe('bubbles', () => {
  const ride = { sport: 'ride', moving_s: 3000, distance_m: 17_120, ascent_m: 439 };
  it('show the metric chosen', () => {
    expect(bubbleLabel(valueOf(ride, 'time'), 'time', 'es')).toBe('0:50');
    expect(bubbleLabel(valueOf(ride, 'distance'), 'distance', 'es')).toBe('17,1');
    expect(bubbleLabel(valueOf(ride, 'ascent'), 'ascent', 'es')).toBe('439');
    expect(bubbleLabel(7620, 'time', 'es')).toBe('2:07');
  });
  it('grow with it, up to a limit', () => {
    expect(bubbleSize(0, 'time')).toBe(0);
    expect(bubbleSize(600, 'time')).toBeLessThan(bubbleSize(3600, 'time'));
    expect(bubbleSize(7200, 'time')).toBe(54);
    expect(bubbleSize(20_000, 'time')).toBe(54);
  });
});

describe('weekMark', () => {
  const streak = { since: '2026-10-26', weeks: 3 };
  it('marks the streak, this week and the rest', () => {
    expect(weekMark('2026-11-09', today, true, streak)).toBe('current');
    expect(weekMark('2026-11-02', today, true, streak)).toBe('streak');
    expect(weekMark('2026-10-19', today, false, streak)).toBe('missed');
    expect(weekMark('2026-10-12', today, true, streak)).toBe('done');
    expect(weekMark('2026-11-16', today, false, streak)).toBe('future');
  });
  it('leaves this week open when the streak ends last week', () => {
    expect(weekMark('2026-11-09', today, false, { since: null, weeks: 0 })).toBe('future');
  });
});
