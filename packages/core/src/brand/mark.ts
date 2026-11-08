/**
 * The Zankup mark (docs/brand/README.md, section 2): a Z walked bottom-up from a start ring, whose last
 * stroke turns back and points up. The single source for the PWA (CSS mask or inline SVG) and the
 * Android app (SVG path data). One colour: it always takes the theme's foreground (`currentColor`).
 *
 * Kept identical to docs/brand/assets/logo-mark.svg by a test.
 */

export const MARK_VIEWBOX = { width: 120, height: 90 } as const;

/** Visual bounds inside the viewBox: centre the mark on (65.5, 47), not on the viewBox centre. */
export const MARK_BOUNDS = { minX: 17.5, minY: 11.5, maxX: 113.5, maxY: 82.5 } as const;

export const MARK_SHAPES = {
  /** The Z: bottom stroke from the ring, diagonal, top stroke back towards the arrow. */
  path: { d: 'M88 76 H24 L96 28 H44', strokeWidth: 13 },
  /** The start ring. */
  ring: { cx: 100, cy: 76, r: 9.5, strokeWidth: 8 },
  /** The arrow at the end of the top stroke, pointing back and up. */
  arrow: { points: '20,28 40,14 40,42', strokeWidth: 5 },
} as const;

/** The mark as an SVG document in one colour (default `currentColor`). */
export function markSvg(color = 'currentColor', label = 'Zankup'): string {
  const { path, ring, arrow } = MARK_SHAPES;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_VIEWBOX.width} ${MARK_VIEWBOX.height}"` +
    ` role="img" aria-label="${label}">` +
    `<path d="${path.d}" fill="none" stroke="${color}" stroke-width="${path.strokeWidth}"` +
    ` stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="${ring.cx}" cy="${ring.cy}" r="${ring.r}" fill="none" stroke="${color}"` +
    ` stroke-width="${ring.strokeWidth}"/>` +
    `<polygon points="${arrow.points}" fill="${color}" stroke="${color}"` +
    ` stroke-width="${arrow.strokeWidth}" stroke-linejoin="round"/>` +
    `</svg>`
  );
}

/**
 * A `url(…)` for a CSS mask: the element's `background: currentColor` shows through, so the mark takes
 * the colour of whatever theme it sits on.
 */
export function markMaskUrl(): string {
  return `url("data:image/svg+xml,${encodeURIComponent(markSvg('#000'))}")`;
}
