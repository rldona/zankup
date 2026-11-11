import { describe, expect, it } from 'vitest';

import { compare, comparisonLabels } from './compare';

describe('compare', () => {
  it('gives the change and the bars, the larger one full', () => {
    expect(compare(258, 210)).toEqual({ percent: 23, now: 1, before: 210 / 258 });
    expect(compare(1978, 4037)).toEqual({ percent: -51, now: 1978 / 4037, before: 1 });
  });

  it('has no change without a year before, and empty bars without anything', () => {
    expect(compare(5, 0).percent).toBeNull();
    expect(compare(0, 0)).toEqual({ percent: null, now: 0, before: 0 });
  });

  const t = (key: string) => key;

  it('names a year, whole months, or any other span, and nothing for All', () => {
    expect(comparisonLabels({ from: '2026-01-01', to: '2027-01-01' }, 'en', t)).toEqual(['2025', '2026']);
    expect(comparisonLabels({ from: '2026-03-01', to: '2026-04-01' }, 'en', t)).toEqual([
      'Mar 2025',
      'Mar 2026',
    ]);
    expect(comparisonLabels({ from: '2026-03-01', to: '2026-07-01' }, 'en', t)).toEqual([
      'Mar–Jun 2025',
      'Mar–Jun 2026',
    ]);
    expect(comparisonLabels({ from: '2025-11-12', to: '2026-11-12' }, 'en', t)).toEqual([
      'stats.compare.before',
      'stats.compare.now',
    ]);
    expect(comparisonLabels({ from: '2015-01-01', to: '2026-11-12' }, 'en', t)).toBeNull();
  });
});
