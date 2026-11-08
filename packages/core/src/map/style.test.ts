import { describe, expect, it } from 'vitest';

import { themes, THEMES } from '../tokens';
import { alpha, mix } from './colour';
import { mapStyle } from './style';

describe('map style', () => {
  it('mixes colours', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#102030', '#102030', 0.7)).toBe('#102030');
    expect(alpha('#ff0000', 0.5)).toBe('rgba(255,0,0,0.5)');
  });

  it.each(THEMES)('is drawn with the %s theme', (name) => {
    const style = mapStyle(themes[name]);
    const layers = style.layers as { id: string; paint?: Record<string, unknown> }[];
    expect(layers[0]?.paint?.['background-color']).toBe(themes[name].bg);
    expect(new Set(layers.map((l) => l.id)).size).toBe(layers.length);
    expect(JSON.stringify(style)).not.toContain('undefined');
  });
});
