import { describe, expect, it } from 'vitest';

import { changeText, racePace, raceTime, series, timeTicks, valueOn } from './raceTimes';

describe('race times', () => {
  it('are written as Strava does', () => {
    expect(raceTime(24 * 60 + 54)).toBe('24:54');
    expect(raceTime(2 * 3600 + 95)).toBe('2:01:35');
    expect(racePace(1494, 5000)).toBe('4:59');
    expect(racePace(4 * 3600 + 45 * 60 + 35, 42195)).toBe('6:46');
  });
  it('change in short words', () => {
    expect(changeText(2)).toBe('2s');
    expect(changeText(-226)).toBe('3min 46s');
    expect(changeText(991)).toBe('16min 31s');
  });
});

describe('history', () => {
  const history = [
    { day: '2026-06-01', value: 1500 },
    { day: '2026-09-10', value: 1480 },
    { day: '2026-11-01', value: 1494 },
  ];
  it('gives the prediction on a past day', () => {
    expect(valueOn(history, '2026-10-14')).toBe(1480);
    expect(valueOn(history, '2026-01-01')).toBe(1500);
    expect(valueOn([], '2026-01-01')).toBeNull();
  });
  it('draws a range from its first day to today', () => {
    expect(series(history, '2026-10-14', '2026-11-15')).toEqual([
      { day: '2026-10-14', value: 1480 },
      { day: '2026-11-01', value: 1494 },
      { day: '2026-11-15', value: 1494 },
    ]);
    expect(series(history, '2026-11-10', '2026-11-15')).toHaveLength(2); // no change: a flat line
  });
  it('has round time ticks', () => {
    // hardly moved: an axis 4 % of the time wide, centred on it
    expect(timeTicks(1492, 1494)).toEqual([1440, 1470, 1500, 1530]);
    // 4:10:00 to 4:46:00 in ten-minute steps, up to 4:50:00 (Strava's marathon axis)
    expect(timeTicks(4 * 3600 + 10 * 60, 4 * 3600 + 46 * 60)).toEqual([
      15_000, 15_600, 16_200, 16_800, 17_400,
    ]);
  });
});
