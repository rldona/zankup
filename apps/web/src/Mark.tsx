import { MARK_SHAPES, MARK_VIEWBOX } from '@zankup/core';

/**
 * The Zankup mark (docs/brand/README.md, section 2): the stride, one stroke in the current colour.
 * The size comes from CSS (`.brand-mark`); `height` overrides it when a one-off size is needed.
 */
export function Mark({ height }: { height?: string }) {
  const { path } = MARK_SHAPES;
  return (
    <svg
      className="brand-mark"
      viewBox={`0 0 ${MARK_VIEWBOX.width} ${MARK_VIEWBOX.height}`}
      aria-hidden="true"
      focusable="false"
      style={height ? { height } : undefined}
    >
      <path
        d={path.d}
        fill="none"
        stroke="currentColor"
        strokeWidth={path.strokeWidth}
        strokeLinecap={path.linecap}
      />
    </svg>
  );
}
