/** Small colour helpers for styles generated from the tokens (map, charts). #rrggbb in and out. */

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** `a` blended towards `b`: 0 gives `a`, 1 gives `b`. */
export function mix(a: string, b: string, amount: number): string {
  const ca = channels(a);
  const cb = channels(b);
  return `#${ca
    .map((v, i) => Math.round(v + ((cb[i] ?? v) - v) * amount))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** rgba() of a #rrggbb colour. */
export function alpha(hex: string, opacity: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r},${g},${b},${opacity})`;
}
