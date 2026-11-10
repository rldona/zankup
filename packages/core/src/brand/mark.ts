/**
 * The Zankup mark (docs/brand/README.md, section 2): the stride. The n and the u of the wordmark drawn as one
 * line that climbs, arches over, drops down the shared stem and arches back up: a stride (zancada), or a route
 * out and back. Built on the Momo Trust Display geometry (font units: stems to the x-height, 206-unit arches) at
weight 260/1000 em, with flat terminals like the typeface's; one colour,
 * it always takes the theme's foreground (`currentColor`). The single source for the PWA (CSS mask or inline
 * SVG) and the Android app (SVG path data).
 *
 * Kept identical to docs/brand/assets/logo-mark.svg by a test.
 */

export const MARK_VIEWBOX = { width: 1106, height: 1300 } as const;

/** Visual bounds inside the viewBox: ten units of margin on every side, so the mark is centred on the viewBox centre (553, 650). */
export const MARK_BOUNDS = { minX: 10, minY: 10, maxX: 1096, maxY: 1290 } as const;

export const MARK_SHAPES = {
  /** One stroke: left stem up, arch over (the n), shared stem down, arch under (the u), right stem up. */
  path: {
    d: 'M140 710 V346 A206 206 0 0 1 553 346 V954 A206 206 0 0 0 966 954 V590',
    strokeWidth: 260,
    linecap: 'butt',
  },
} as const;

/** The mark as an SVG document in one colour (default `currentColor`). */
export function markSvg(color = 'currentColor', label = 'Zankup'): string {
  const { path } = MARK_SHAPES;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_VIEWBOX.width} ${MARK_VIEWBOX.height}"` +
    ` role="img" aria-label="${label}">` +
    `<path d="${path.d}" fill="none" stroke="${color}" stroke-width="${path.strokeWidth}"` +
    ` stroke-linecap="${path.linecap}"/>` +
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
