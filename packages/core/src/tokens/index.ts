/**
 * Design tokens: the single source for the PWA's CSS variables and the React Native theme (OS-214).
 * Values come from the prototype's themes. "System" is not a theme: it picks light or dark from the OS.
 */
import tokens from './tokens.json';

export type ThemeName = keyof typeof tokens.themes;
export type Theme = (typeof tokens.themes)[ThemeName];
export type ThemeToken = Exclude<keyof Theme, 'scheme'>;

export const THEMES = Object.keys(tokens.themes) as ThemeName[];
export const commonTokens = tokens.common;
export const themes = tokens.themes;

const kebab = (name: string) => name.replace(/[A-Z0-9]+/g, (m) => `-${m.toLowerCase()}`);

/** CSS custom properties for a theme, e.g. `{ '--bg': '#f4f5f3', '--accent-fg': '#fff', … }`. */
export function cssVariables(theme: ThemeName): Record<string, string> {
  const { scheme: _scheme, ...colours } = themes[theme];
  const entries = Object.entries({ ...commonTokens, ...colours }).map(
    ([k, v]) => [`--${kebab(k)}`, v] as const,
  );
  return Object.fromEntries(entries);
}

/** A CSS rule with the theme's variables, ready to inject: `[data-theme="dark"]{color-scheme:dark;--bg:…}`. */
export function themeCss(theme: ThemeName, selector = `[data-theme="${theme}"]`): string {
  const body = Object.entries(cssVariables(theme))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  return `${selector}{color-scheme:${themes[theme].scheme};${body}}`;
}
