/**
 * The sign-in's rules, as in the PWA (OS-524), without React Native (tested on their own): what an
 * answer from the API means for the person, when the code's challenge has expired, a plausible e-mail
 * and how strong a new password looks.
 */
import type { MessageKey } from '@zankup/core';

export const validEmail = (email: string) => /^\S+@\S+\.\S+$/.test(email.trim());

/** The message for a failed answer, never saying which field was wrong; null status = no connection. */
export function failure(
  status: number | null,
  retryAfter: string | null,
): { key: MessageKey; values?: Record<string, string> } {
  if (status === null) return { key: 'signIn.error.network' };
  if (status === 403) return { key: 'signIn.error.noTotp' };
  if (status === 429) return { key: 'signIn.error.tooMany', values: { seconds: retryAfter ?? '30' } };
  return { key: 'signIn.error.wrong' };
}

/** The challenge is a JWT valid for 5 minutes: past its expiry, the password has to be entered again. */
export function challengeExpired(challenge: string, now = Date.now()): boolean {
  try {
    const part = (challenge.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '='))) as { exp?: number };
    return typeof payload.exp === 'number' && payload.exp * 1000 < now;
  } catch {
    return false;
  }
}

/** Only digits, at most six: what the code boxes keep of what was typed, pasted or autofilled. */
export const codeDigits = (value: string) => value.replace(/\D/g, '').slice(0, 6);

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP", easier to type into an authenticator app. */
export const groupKey = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;
