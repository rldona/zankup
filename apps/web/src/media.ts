import { useSyncExternalStore } from 'react';

/**
 * Whether a media query matches, kept up to date as the window changes: for the few layouts that move
 * parts of a screen from one column to another (CSS alone cannot), as the activity's side column on a
 * desktop. Without `matchMedia` (tests, an old browser) it never matches.
 */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof matchMedia === 'undefined') return () => undefined;
      const list = matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => typeof matchMedia !== 'undefined' && matchMedia(query).matches,
    () => false,
  );
}

/** The phone (below 600 px) and the desktop (from 1200 px), as the frame's sizes in index.css. */
export const PHONE = '(max-width: 599px)';
export const DESKTOP = '(min-width: 1200px)';
