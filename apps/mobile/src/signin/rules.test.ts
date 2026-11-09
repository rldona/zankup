import { describe, expect, it } from 'vitest';

import { challengeExpired, codeDigits, failure, groupKey, validEmail } from './rules';

const jwt = (payload: object) =>
  `x.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.y`;

describe('sign-in rules', () => {
  it('turns answers into the same messages as the PWA', () => {
    expect(failure(null, null).key).toBe('signIn.error.network');
    expect(failure(403, null).key).toBe('signIn.error.noTotp');
    expect(failure(429, '12')).toEqual({ key: 'signIn.error.tooMany', values: { seconds: '12' } });
    expect(failure(401, null).key).toBe('signIn.error.wrong');
  });

  it('knows when the challenge has expired', () => {
    const now = 1_800_000_000_000;
    expect(challengeExpired(jwt({ exp: now / 1000 - 1 }), now)).toBe(true);
    expect(challengeExpired(jwt({ exp: now / 1000 + 60 }), now)).toBe(false);
    expect(challengeExpired('not a jwt', now)).toBe(false);
  });

  it('keeps six digits of whatever is typed or pasted', () => {
    expect(codeDigits('123 456')).toBe('123456');
    expect(codeDigits('12-34-56-78')).toBe('123456');
  });

  it('checks e-mails and groups keys', () => {
    expect(validEmail(' me@example.com ')).toBe(true);
    expect(validEmail('me@example')).toBe(false);
    expect(groupKey('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
  });
});
