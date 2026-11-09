export * from './mark';
export * from './wordmark';

/** Typeface for brand text only (wordmark, sign-in claim, splash); the interface uses the system stack. */
export const BRAND_FONT_FAMILY = "'Momo Trust Display', system-ui, sans-serif";
export const BRAND_FONT_STYLESHEET =
  'https://fonts.googleapis.com/css2?family=Momo+Trust+Display&display=swap';

/**
 * Google's G in one colour, for "Continue with Google" on the accent (white, as other apps show it):
 * a thick ring open at the top right and the bar, in a 48 × 48 box. `ring` is a stroke, `bar` a fill.
 */
export const GOOGLE_G = {
  size: 48,
  ring: { d: 'M37.02 13.07 A17 17 0 1 0 41 24', strokeWidth: 10 },
  bar: { d: 'M24 19 H46 V29 H24 Z' },
} as const;
