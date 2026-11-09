import { describe, expect, it, vi } from 'vitest';

vi.mock('@shopify/react-native-skia', () => ({}));
vi.mock('react-native', () => ({}));
vi.mock('./theme', () => ({}));

const { domainOf, linePath } = await import('./charts');

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
});
