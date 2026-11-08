import { isThemeChoice, settingsQuery, THEME_STORAGE_KEY, type ThemeChoice } from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';

import { api } from './api';

/**
 * Themes (OS-214). The CSS variables of every theme and the script that applies the saved one are
 * inline in index.html (vite.config.ts), so the first paint is already right. Here: reading and
 * changing the choice, keeping it in localStorage (this browser) and on the server (everywhere else).
 */

const listeners = new Set<() => void>();
const dark = typeof matchMedia === 'undefined' ? null : matchMedia('(prefers-color-scheme: dark)');

function read(): ThemeChoice {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

/** Applies a theme to the page and remembers it in this browser. */
export function applyTheme(choice: ThemeChoice, doc: Document = document): void {
  const root = doc.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  try {
    if (choice === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Private mode or storage blocked: the theme still applies for this visit.
  }
  paintBrowserChrome(doc);
  listeners.forEach((notify) => notify());
}

/** The browser's address bar and the PWA's title bar take the theme's surface colour. */
function paintBrowserChrome(doc: Document): void {
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const surface = getComputedStyle(doc.documentElement).getPropertyValue('--surface').trim();
  if (meta && surface) meta.content = surface;
}

/** On start: browser chrome in the theme's colour, and again whenever the device switches light/dark. */
export function installTheme(doc: Document = document): void {
  paintBrowserChrome(doc);
  dark?.addEventListener('change', () => paintBrowserChrome(doc));
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    read,
    () => 'system',
  );
}

/** Changes the theme here at once and saves it on the server. */
export function useSetTheme() {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: async (theme: ThemeChoice) => {
      const { data } = await api.PATCH('/api/settings', { body: { theme } });
      return data;
    },
    onSuccess: (data) => {
      if (data) queryClient.setQueryData(settingsQuery(api).queryKey, data);
    },
  });
  return (theme: ThemeChoice) => {
    applyTheme(theme);
    queryClient.setQueryData(settingsQuery(api).queryKey, { theme }); // so a refetch cannot undo it
    save.mutate(theme);
  };
}

/**
 * Signed in: the theme saved on the server wins over this browser's copy, so a change made on another
 * device shows up here too.
 */
export function useServerTheme(): void {
  const settings = useQuery(settingsQuery(api));
  const theme = settings.data?.theme;
  useEffect(() => {
    if (isThemeChoice(theme) && theme !== read()) applyTheme(theme);
  }, [theme]);
}
