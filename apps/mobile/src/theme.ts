/**
 * Colours from the shared tokens (OS-214): the theme picked in Settings, or light/dark following the
 * phone. "System" also takes Android's dynamic accent colour when the phone has one (Material You).
 */
import { commonTokens, isThemeChoice, themes, type ThemeChoice, type ThemeName } from '@zankup/core';
import { createContext, useContext } from 'react';
import { PlatformColor, useColorScheme } from 'react-native';

import { keys, readSync } from './storage';

export type Palette = (typeof themes)[ThemeName] &
  typeof commonTokens & { name: ThemeName; dynamic: boolean };

export function savedTheme(): ThemeChoice {
  const saved = readSync(keys.theme);
  return isThemeChoice(saved) ? saved : 'system';
}

export function palette(choice: ThemeChoice, scheme: 'light' | 'dark'): Palette {
  const name: ThemeName = choice === 'system' ? scheme : choice;
  return { ...commonTokens, ...themes[name], name, dynamic: choice === 'system' };
}

/**
 * Android's dynamic colours (Material You), as Material pairs them: primary and "on primary" are
 * accent1 600 and 0 in light, 200 and 800 in dark, so text on a primary button is always readable.
 */
export const dynamicAccent = {
  light: PlatformColor('@android:color/system_accent1_600'),
  dark: PlatformColor('@android:color/system_accent1_200'),
};
export const dynamicOnAccent = {
  light: PlatformColor('@android:color/system_accent1_0'),
  dark: PlatformColor('@android:color/system_accent1_800'),
};

export const ThemeContext = createContext<{ choice: ThemeChoice; setChoice: (c: ThemeChoice) => void }>({
  choice: 'system',
  setChoice: () => undefined,
});

export function useTheme(): Palette {
  const { choice } = useContext(ThemeContext);
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return palette(choice, scheme);
}
