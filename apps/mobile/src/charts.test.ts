import { describe, expect, it, vi } from 'vitest';

vi.mock('@shopify/react-native-skia', () => ({}));
vi.mock('react-native', () => ({}));
vi.mock('react-native-gesture-handler', () => ({}));
vi.mock('./theme', () => ({}));

const { dayTicks, domainOf, linePath, niceScale, shortNumber } = await import('./charts');

describe('charts', () => {
  it('pads a line and keeps bars on zero', () => {
    expect(domainOf({ kind: 'line', label: '', color: '', values: [50, null, 60] })).toEqual([49, 61]);
    expect(domainOf({ kind: 'line', label: '', color: '', values: [] })).toEqual([0, 1]);
    const bars = {
      kind: 'bars' as const,
      series: [
        { label: '', color: '', values: [1, 2] },
        { label: '', color: '', values: [3, null] },
      ],
    };
    expect(domainOf(bars)).toEqual([0, 4]); // stacked: 1 + 3
    expect(domainOf({ kind: 'bars', series: [{ label: '', color: '', values: [-5, 3] }] })).toEqual([-5, 3]);
    expect(domainOf({ kind: 'line', label: '', color: '', values: [1], domain: [0, 100] })).toEqual([0, 100]);
  });

  it('breaks a line where a day has no value', () => {
    const segments = linePath([0, 10, null, 5], 30, 100, [0, 10]);
    expect(segments).toEqual([
      [
        [0, 100],
        [10, 0],
      ],
      [[30, 50]],
    ]);
  });

  it('rounds an axis to four even steps', () => {
    expect(niceScale([0, 100])).toEqual({ domain: [0, 100], ticks: [0, 25, 50, 75, 100] });
    expect(niceScale([0, 7.6]).ticks).toEqual([0, 2, 4, 6, 8]);
    expect(niceScale([47.3, 61.2]).ticks).toEqual([45, 50, 55, 60, 65]);
    expect(niceScale([-12, 30]).ticks).toEqual([-20, 0, 20, 40, 60]);
  });

  it('writes ticks short and spreads the days', () => {
    expect([shortNumber(1.25), shortNumber(8), shortNumber(152.4), shortNumber(12500)]).toEqual([
      '1,3',
      '8',
      '152',
      '12.5k',
    ]);
    expect(dayTicks(3)).toEqual([0, 1, 2]);
    expect(dayTicks(30)).toEqual([0, 7, 15, 22, 29]);
  });
});
