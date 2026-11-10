import { describe, expect, it } from 'vitest';

import { effortShown, eventShown } from './efforts';

describe('effortShown', () => {
  it('leaves the mile distances out with metric units, and keeps everything with miles', () => {
    expect(effortShown('1mile', 'km')).toBe(false);
    expect(effortShown('half_mile', 'km')).toBe(false);
    expect(effortShown('5k', 'km')).toBe(true);
    expect(effortShown('marathon', 'km')).toBe(true);
    expect(effortShown('1mile', 'mi')).toBe(true);
    expect(effortShown('5k', 'mi')).toBe(true);
  });

  it('hides a record event at a mile distance with km, and keeps every other event', () => {
    expect(eventShown({ kind: 'record', payload: { distance_key: '1mile' } }, 'km')).toBe(false);
    expect(eventShown({ kind: 'record', payload: { distance_key: '5k' } }, 'km')).toBe(true);
    expect(eventShown({ kind: 'estimate_up', payload: {} }, 'km')).toBe(true);
  });
});
