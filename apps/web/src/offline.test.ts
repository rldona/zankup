import type { Query } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { keepOffline } from './offline';

const query = (key: unknown[], status = 'success') =>
  ({ queryKey: key, state: { status } }) as unknown as Query;

describe('offline mode', () => {
  it('keeps what was seen, and only that', () => {
    expect(keepOffline(query(['activities', { sport: [] }]))).toBe(true);
    expect(keepOffline(query(['activity', 7, 'streams']))).toBe(true);
    expect(keepOffline(query(['me']))).toBe(true);
    expect(keepOffline(query(['activity', 7], 'error'))).toBe(false);
    expect(keepOffline(query(['devices']))).toBe(false); // sessions and syncs are live data
    expect(keepOffline(query(['syncs']))).toBe(false);
  });
});
