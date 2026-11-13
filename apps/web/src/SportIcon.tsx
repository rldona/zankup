import { SPORT_ICONS, type Sport } from '@zankup/core';
import type { CSSProperties } from 'react';

import { MaterialIcon } from './MaterialIcon';

/**
 * Each sport's glyph framed on itself: Material Symbols sit off the middle of their 960 box (the runner
 * to the left, the bike from edge to edge, "other" flat), so each gets a square box centred on its own
 * drawing with the same margin, measured from the paths' bounds. They then sit in the middle of their
 * tile and look the same size.
 */
const FRAMES: Record<Sport, string> = {
  run: '-28 -940 940 940',
  ride: '-40 -1010 1040 1040',
  strength: '33 -928 895 895',
  walk: '22 -940 940 940',
  row: '7 -960 988 988',
  swim: '40 -920 880 880',
  other: '40 -880 880 880',
};

/** The sport's Material Symbol (packages/core), drawn in the sport's colour on a soft tile. */
export function SportGlyph({ sport }: { sport: Sport }) {
  return <MaterialIcon name={SPORT_ICONS[sport]} viewBox={FRAMES[sport]} />;
}

export function SportIcon({ sport }: { sport: Sport }) {
  return (
    <span className="sp" style={{ '--sport': `var(--${sport})` } as CSSProperties}>
      <SportGlyph sport={sport} />
    </span>
  );
}
