import { describe, expect, it } from 'vitest';

import { periodOf } from './period';

const TODAY = new Date(2026, 10, 9); // 9 Nov 2026

describe('stats periods', () => {
  it('turns each choice into dates and a bucket', () => {
    expect(periodOf('last12', TODAY, 2014)).toEqual({ from: '2025-11-10', to: '2026-11-10', unit: 'month' });
    expect(periodOf('2025', TODAY, 2014)).toEqual({ from: '2025-01-01', to: '2026-01-01', unit: 'month' });
    expect(periodOf('2026-02', TODAY, 2014)).toEqual({ from: '2026-02-01', to: '2026-03-01', unit: 'day' });
    expect(periodOf('2025-12', TODAY, 2014).to).toBe('2026-01-01');
    expect(periodOf('all', TODAY, 2014)).toEqual({ from: '2014-01-01', to: '2026-11-10', unit: 'year' });
  });
});
