/**
 * The Zankup mark (docs/brand/README.md, section 2): the stride. The n and the u of the wordmark drawn as one
 * line that climbs, arches over, drops down the shared stem and arches back up: a stride (zancada), or a route
 * out and back. Built on the Momo Trust Display geometry at a heavier weight, with round terminals; one colour,
 * it always takes the theme's foreground (`currentColor`). The single source for the PWA (CSS mask or inline
 * SVG) and the Android app (SVG path data).
 *
 * Kept identical to docs/brand/assets/logo-mark.svg by a test.
 */

export const MARK_VIEWBOX = { width: 120, height: 134 } as const;

/** Visual bounds inside the viewBox: one unit of margin on every side, so the mark is centred on the viewBox centre (60, 67). */
export const MARK_BOUNDS = { minX: 1, minY: 1, maxX: 119, maxY: 133 } as const;

export const MARK_SHAPES = {
  /** One stroke: left stem up, arch over (the n), shared stem down, arch under (the u), right stem up. */
  path: { d: 'M16 73 V38 A22 22 0 0 1 60 38 V96 A22 22 0 0 0 104 96 V61', strokeWidth: 30 },
} as const;

/** The mark as an SVG document in one colour (default `currentColor`). */
export function markSvg(color = 'currentColor', label = 'Zankup'): string {
  const { path } = MARK_SHAPES;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_VIEWBOX.width} ${MARK_VIEWBOX.height}"` +
    ` role="img" aria-label="${label}">` +
    `<path d="${path.d}" fill="none" stroke="${color}" stroke-width="${path.strokeWidth}"` +
    ` stroke-linecap="round" stroke-linejoin="round"/>` +
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
