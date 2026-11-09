import { describe, expect, it } from 'vitest';

import { keyInvalidated, normaliseUrl, screenFor, webOrigin } from './links';

describe('links', () => {
  it('normalises the instance address', () => {
    expect(normaliseUrl(' api.zankup.com/ ')).toBe('https://api.zankup.com');
    expect(normaliseUrl('http://localhost:8000')).toBe('http://localhost:8000');
    expect(normaliseUrl('HTTPS://my.zankup.dev//')).toBe('HTTPS://my.zankup.dev');
  });

  it('opens the screen a notification is about', () => {
    expect(screenFor('/activities/42')).toBe('/activity/42');
    expect(screenFor('/settings/import')).toBe('/import');
    expect(screenFor('/settings#ai')).toBe('/settings/ai');
    expect(screenFor('/settings#health')).toBe('/settings/health');
    expect(screenFor('/settings#mcp')).toBe('/settings/ai');
    expect(screenFor('/settings#nothing')).toBe('/settings');
    expect(screenFor('/settings')).toBe('/settings');
    expect(screenFor('/coach')).toBe('/coach'); // the weekly report's notification
    expect(screenFor('/health?days=90')).toBe('/health');
    expect(screenFor('/gear')).toBe('/gear');
    expect(screenFor('/sync')).toBe('/sync');
    expect(screenFor('/coachella')).toBe('/');
    expect(screenFor('/profile?tab=estimates')).toBe('/profile');
    expect(screenFor(undefined)).toBe('/');
    expect(screenFor('/elsewhere')).toBe('/');
  });

  it('shares links on the web app, not on the API host', () => {
    expect(webOrigin('https://api.zankup.com')).toBe('https://zankup.com');
    expect(webOrigin('https://zankup.example.com')).toBe('https://zankup.example.com');
  });

  it('signs out only when Android invalidated the key', () => {
    expect(
      keyInvalidated(
        new Error(
          'android.security.keystore.KeyPermanentlyInvalidatedException: Key permanently invalidated',
        ),
      ),
    ).toBe(true);
    expect(keyInvalidated(new Error('User canceled the authentication'))).toBe(false);
    expect(keyInvalidated(new Error('Too many attempts. Try again later.'))).toBe(false);
  });
});
