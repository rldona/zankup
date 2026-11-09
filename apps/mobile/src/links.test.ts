import { describe, expect, it } from 'vitest';

import { normaliseUrl, screenFor, webOrigin } from './links';

describe('links', () => {
  it('normalises the instance address', () => {
    expect(normaliseUrl(' api.zankup.com/ ')).toBe('https://api.zankup.com');
    expect(normaliseUrl('http://localhost:8000')).toBe('http://localhost:8000');
    expect(normaliseUrl('HTTPS://my.zankup.dev//')).toBe('HTTPS://my.zankup.dev');
  });

  it('opens the screen a notification is about', () => {
    expect(screenFor('/activities/42')).toBe('/activity/42');
    expect(screenFor('/settings/import')).toBe('/import');
    expect(screenFor('/settings#ai')).toBe('/settings');
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
});
