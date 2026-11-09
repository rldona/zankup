/** Pure helpers (tested without a phone): instance URLs, where notifications and links lead, keystore errors. */

/** "zankup.example.com" → "https://zankup.example.com", without a trailing slash. */
export function normaliseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** The settings screens, and the web page's anchors that lead to each. */
export const SETTINGS_SECTIONS = [
  'general',
  'heart',
  'notifications',
  'ai',
  'privacy',
  'health',
  'data',
  'account',
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const SECTION_OF: Record<string, SettingsSection> = {
  ...Object.fromEntries(SETTINGS_SECTIONS.map((s) => [s, s])),
  mcp: 'ai',
  zones: 'heart',
  garmin: 'account',
  sessions: 'account',
};

/** The app screen for a notification's web path ("/activities/12" → "/activity/12"). */
export function screenFor(url: unknown): string {
  if (typeof url !== 'string') return '/';
  const activity = /^\/activities\/(\d+)/.exec(url);
  if (activity) return `/activity/${activity[1]}`;
  if (url.startsWith('/settings/import')) return '/import';
  for (const screen of ['/coach', '/health', '/sync', '/gear'])
    if (url === screen || url.startsWith(`${screen}?`) || url.startsWith(`${screen}#`)) return screen;
  if (url.startsWith('/settings')) {
    const section = /#([a-z]+)/.exec(url)?.[1];
    const target = section && SECTION_OF[section];
    return target ? `/settings/${target}` : '/settings';
  }
  if (url.startsWith('/profile')) return '/profile';
  return '/';
}

/** The web app's address for share links: api.zankup.com → zankup.com; other instances as they are. */
export function webOrigin(instance: string): string {
  return instance.replace(/^(https?:\/\/)api\./, '$1');
}

/** Whether reading the session failed because Android invalidated its key (fingerprints changed). */
export function keyInvalidated(error: unknown): boolean {
  return /invalidated/i.test(String(error));
}
