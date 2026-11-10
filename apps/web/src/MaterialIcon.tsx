import { MATERIAL_ICONS, MATERIAL_VIEWBOX, type MaterialIcon as Name } from '@zankup/core';

/** A Material Symbol (Rounded) from packages/core, filled in the current colour, at the size of `svg.i`. */
export function MaterialIcon({ name }: { name: Name }) {
  return (
    <svg className="i m" viewBox={MATERIAL_VIEWBOX} aria-hidden="true">
      <path d={MATERIAL_ICONS[name]} />
    </svg>
  );
}
