import { afterEach, describe, expect, it, vi } from 'vitest';

import { message, pluralCategory } from './index';

describe('plurals without Intl.PluralRules (Hermes)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('falls back to one/other', () => {
    vi.stubGlobal('Intl', { ...Intl, PluralRules: undefined });
    expect(pluralCategory('en', 1)).toBe('one');
    expect(pluralCategory('es', 3)).toBe('other');
    expect(message('en', 'mobile.results', { count: 1 })).toBe('1 activity');
    expect(message('es', 'mobile.results', { count: 2 })).toBe('2 actividades');
  });
});
