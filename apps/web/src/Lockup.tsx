import { markMaskUrl } from '@zankup/core';

const mask = markMaskUrl();

/** Mark + wordmark (docs/brand/README.md, section 4). */
export function Lockup({ size = '1.5rem' }: { size?: string }) {
  return (
    <span className="lockup" style={{ fontSize: size }}>
      <span className="mark" aria-hidden="true" style={{ maskImage: mask, WebkitMaskImage: mask }} />
      <span className="wordmark">Zankup</span>
    </span>
  );
}
