import type { Sport } from '@zankup/core';
import type { CSSProperties, ReactNode } from 'react';

/** Sport glyphs from the prototype: 24×24 strokes, drawn in the sport's colour on a soft tile. */
const GLYPHS: Record<Sport, ReactNode> = {
  run: <path d="M13 4a2 2 0 1 0 0 .01M8 21l3-6 3 3v3M6 12l3-4 4 1 3 4 3 1" />,
  ride: (
    <>
      <circle cx="6" cy="17" r="3.5" />
      <circle cx="18" cy="17" r="3.5" />
      <path d="M6 17l4-8h5l3 8M10 9l2 8h-6M14 6h3" />
    </>
  ),
  strength: <path d="M3 10v4M6 7v10M18 7v10M21 10v4M6 12h12" />,
  walk: <path d="M13 4a2 2 0 1 0 0 .01M10 21l2-7 3 3v4M9 11l2-3 3 1 2 4" />,
  row: <path d="M4 20l8-8M14 10l6-6M3 17l4 4M17 3l4 4M9 15l2-2" />,
  swim: (
    <>
      <circle cx="16" cy="6" r="2" />
      <path d="M2 18c2 0 2-1.5 4-1.5S8 18 10 18s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M5 14l5-5 3 3 3-3" />
    </>
  ),
  other: <circle cx="12" cy="12" r="8" />,
};

export function SportGlyph({ sport }: { sport: Sport }) {
  return (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
      {GLYPHS[sport]}
    </svg>
  );
}

export function SportIcon({ sport }: { sport: Sport }) {
  return (
    <span className="sp" style={{ '--sport': `var(--${sport})` } as CSSProperties}>
      <SportGlyph sport={sport} />
    </span>
  );
}
