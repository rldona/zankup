import { SPORT_ICONS, type Sport } from '@zankup/core';
import type { CSSProperties } from 'react';

import { MaterialIcon } from './MaterialIcon';

/** The sport's Material Symbol (packages/core), drawn in the sport's colour on a soft tile. */
export function SportGlyph({ sport }: { sport: Sport }) {
  return <MaterialIcon name={SPORT_ICONS[sport]} />;
}

export function SportIcon({ sport }: { sport: Sport }) {
  return (
    <span className="sp" style={{ '--sport': `var(--${sport})` } as CSSProperties}>
      <SportGlyph sport={sport} />
    </span>
  );
}
