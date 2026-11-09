import { WORDMARK_PATH, WORDMARK_VIEWBOX } from '@zankup/core';

/**
 * The wordmark (docs/brand/README.md, section 3): ZANKUP as one path in the current colour, shown alone in the
 * header and on the sign-in panel. `height` is the height of the capitals.
 */
export function Wordmark({ height = '1.25rem' }: { height?: string }) {
  const { width, height: h, capHeight } = WORDMARK_VIEWBOX;
  return (
    <svg
      className="wordmark"
      viewBox={`0 0 ${width} ${h}`}
      role="img"
      aria-label="Zankup"
      style={{ height: `calc(${height} * ${h / capHeight})` }}
    >
      <path d={WORDMARK_PATH} fill="currentColor" />
    </svg>
  );
}
