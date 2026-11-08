import { describe, expect, it } from 'vitest';

import {
  catalogues,
  cssVariables,
  formatDistance,
  formatDuration,
  formatHoursMinutes,
  formatMonth,
  localStart,
  formatPace,
  formatSpeed,
  message,
  resolveLocale,
  allThemesCss,
  themeBootScript,
  themeCss,
  themes,
  THEMES,
} from './index';

describe('format', () => {
  it('formats durations like the watch', () => {
    expect(formatDuration(305)).toBe('5:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(-3)).toBe('0:00');
    expect(formatHoursMinutes(3725)).toBe('1 h 2 min');
    expect(formatHoursMinutes(600)).toBe('10 min');
  });

  it('formats distance per locale and units', () => {
    expect(formatDistance(6615, { locale: 'en', units: 'metric' })).toBe('6.62');
    expect(formatDistance(6615, { locale: 'es', units: 'metric' })).toBe('6,62');
    expect(formatDistance(1609.344, { locale: 'en', units: 'imperial' })).toBe('1.00');
  });

  it('formats pace and speed', () => {
    // The reference night run: 6,615 m in 37:37 is 5:41/km.
    expect(formatPace(6615 / 2257, { units: 'metric' })).toBe('5:41');
    expect(formatPace(1609.344 / 600, { units: 'imperial' })).toBe('10:00');
    expect(formatPace(0, { units: 'metric' })).toBe('—');
    expect(formatSpeed(8.4, { locale: 'es', units: 'metric' })).toBe('30,2');
  });

  it('shows activities in the local time where they were recorded', () => {
    expect(localStart('2026-10-31T23:30:00Z', '+01:00')).toBe('2026-11-01T00:30:00');
    expect(localStart('2026-10-31T23:30:00Z', '-05:30')).toBe('2026-10-31T18:00:00');
    expect(localStart('2026-10-31T23:30:00Z', null)).toBe('2026-10-31T23:30:00');
    expect(localStart('2026-10-31T23:30:00Z', 'Europe/Madrid')).toBe('2026-10-31T23:30:00');
  });

  it('names months', () => {
    expect(formatMonth('2026-10', 'en')).toBe('October 2026');
    expect(formatMonth('2026-10', 'es')).toBe('octubre de 2026');
  });
});

describe('i18n', () => {
  it('has every English key in Spanish', () => {
    expect(Object.keys(catalogues.es).sort()).toEqual(Object.keys(catalogues.en).sort());
  });

  it('resolves the browser language, defaulting to English', () => {
    expect(resolveLocale(['es-ES', 'en'])).toBe('es');
    expect(resolveLocale(['fr-FR', 'de'])).toBe('en');
  });

  it('fills placeholders', () => {
    expect(message('es', 'api.connected', { version: '0.1.0' })).toBe('API conectada · v0.1.0');
  });
});

describe('tokens', () => {
  it('applies the saved theme before the first paint, and ignores anything else', () => {
    const run = (saved: string | null) => {
      const root = { dataset: {} as Record<string, string> };
      new Function('localStorage', 'document', themeBootScript())(
        { getItem: () => saved },
        { documentElement: root },
      );
      return root.dataset.theme;
    };
    expect(run('oled')).toBe('oled');
    expect(run('system')).toBeUndefined();
    expect(run('"><script>')).toBeUndefined();
    expect(run(null)).toBeUndefined();
  });

  it('defines the same tokens in every theme', () => {
    const keys = Object.keys(themes.light).sort();
    for (const name of THEMES) expect(Object.keys(themes[name]).sort()).toEqual(keys);
  });

  it('builds CSS variables', () => {
    expect(cssVariables('dark')['--accent-fg']).toBe('#06221a');
    const css = allThemesCss();
    expect(css.startsWith(':root{color-scheme:light;')).toBe(true);
    expect(css).toContain('@media (prefers-color-scheme: dark){:root:not([data-theme]){color-scheme:dark;');
    expect(css).toContain('@media (prefers-contrast: more){:root:not([data-theme]){color-scheme:light;');
    for (const name of THEMES) expect(css).toContain(`[data-theme="${name}"]{`);
    expect(themeCss('oled')).toMatch(/^\[data-theme="oled"\]\{color-scheme:dark;--radius:14px;/);
  });
});
