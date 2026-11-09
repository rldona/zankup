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

/** Android's dynamic accent (Material You), usable as a colour value in styles. */
export const dynamicAccent = PlatformColor('@android:color/system_accent1_500');

export const ThemeContext = createContext<{ choice: ThemeChoice; setChoice: (c: ThemeChoice) => void }>({
  choice: 'system',
  setChoice: () => undefined,
});

export function useTheme(): Palette {
  const { choice } = useContext(ThemeContext);
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return palette(choice, scheme);
}
