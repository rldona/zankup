import { describe, expect, it } from 'vitest';

import {
  catalogues,
  cssVariables,
  formatDistance,
  formatDuration,
  formatHoursMinutes,
  formatPace,
  formatSpeed,
  message,
  resolveLocale,
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
  it('defines the same tokens in every theme', () => {
    const keys = Object.keys(themes.light).sort();
    for (const name of THEMES) expect(Object.keys(themes[name]).sort()).toEqual(keys);
  });

  it('builds CSS variables', () => {
    expect(cssVariables('dark')['--accent-fg']).toBe('#06221a');
    expect(themeCss('oled')).toMatch(/^\[data-theme="oled"\]\{color-scheme:dark;--radius:14px;/);
  });
});
