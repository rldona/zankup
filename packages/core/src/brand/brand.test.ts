import { describe, expect, it } from 'vitest';

import source from '../../../../docs/brand/assets/logo-mark.svg?raw';
import { themes, THEMES } from '../tokens';
import { MARK_SHAPES, markMaskUrl, markSvg } from './mark';

const attrs = (tag: string) => {
  const match = source.match(new RegExp(`<${tag}\\b([^>]*)/>`));
  if (!match?.[1]) throw new Error(`no <${tag}> in logo-mark.svg`);
  return Object.fromEntries([...match[1].matchAll(/([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
};

/** WCAG relative luminance and contrast ratio. */
const luminance = (hex: string) => {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};
const contrast = (a: string, b: string) => {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

describe('brand mark', () => {
  it('matches docs/brand/assets/logo-mark.svg, the source of truth', () => {
    const path = attrs('path');
    const ring = attrs('circle');
    const arrow = attrs('polygon');
    expect(path.d).toBe(MARK_SHAPES.path.d);
    expect(Number(path['stroke-width'])).toBe(MARK_SHAPES.path.strokeWidth);
    expect([ring.cx, ring.cy, ring.r].map(Number)).toEqual([
      MARK_SHAPES.ring.cx,
      MARK_SHAPES.ring.cy,
      MARK_SHAPES.ring.r,
    ]);
    expect(Number(ring['stroke-width'])).toBe(MARK_SHAPES.ring.strokeWidth);
    expect(arrow.points).toBe(MARK_SHAPES.arrow.points);
    expect(Number(arrow['stroke-width'])).toBe(MARK_SHAPES.arrow.strokeWidth);
  });

  it('is one colour and can be used as a CSS mask', () => {
    const svg = markSvg();
    expect(svg.match(/currentColor/g)).toHaveLength(4);
    expect(markSvg('#fff')).not.toContain('currentColor');
    expect(markMaskUrl()).toMatch(/^url\("data:image\/svg\+xml,%3Csvg/);
  });

  it.each(THEMES)('stays legible on the %s theme (3:1 for graphics, WCAG 1.4.11)', (name) => {
    const theme = themes[name];
    expect(contrast(theme.fg, theme.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(theme.fg, theme.surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(theme.accentFg, theme.accent)).toBeGreaterThanOrEqual(3);
  });
});
