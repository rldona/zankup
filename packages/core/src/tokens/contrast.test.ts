import { describe, expect, it } from 'vitest';

import { themes, THEMES, type Theme } from './index';

/** WCAG 2.x relative luminance and contrast ratio of two #rrggbb colours. */
function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

type Colour = Exclude<keyof Theme, 'scheme' | 'shadow'>;
const BACKGROUNDS: Colour[] = ['bg', 'surface', 'surface2'];
const SPORTS: Colour[] = ['run', 'ride', 'strength', 'walk', 'row', 'swim', 'other'];

/** Every pair the interface draws, with the WCAG AA minimum: 4.5:1 for text, 3:1 for graphics. */
const PAIRS: [fg: Colour, bg: Colour, min: number][] = [
  ...(['fg', 'muted', 'accent'] as Colour[]).flatMap((fg) =>
    BACKGROUNDS.map((bg): [Colour, Colour, number] => [fg, bg, 4.5]),
  ),
  ['accentFg', 'accent', 4.5], // buttons
  ['accent', 'accentSoft', 4.5], // the selected item in the sidebar
  ['bg', 'fg', 4.5], // a pressed chip
  ...SPORTS.flatMap((sport) => BACKGROUNDS.map((bg): [Colour, Colour, number] => [sport, bg, 3])),
];

describe('theme contrast (WCAG AA)', () => {
  it.each(THEMES)('%s passes', (name) => {
    const theme = themes[name];
    const failures = PAIRS.filter(([fg, bg, min]) => contrast(theme[fg], theme[bg]) < min).map(
      ([fg, bg, min]) => `${fg} on ${bg}: ${contrast(theme[fg], theme[bg]).toFixed(2)} < ${min}`,
    );
    expect(failures).toEqual([]);
  });
});
