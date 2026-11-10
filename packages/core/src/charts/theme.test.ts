import { describe, expect, it } from 'vitest';

import { themes } from '../tokens';
import { yearColours } from './theme';

describe('yearColours', () => {
  const theme = themes.dark;

  it('gives the selected year the accent and every other year a colour of its own', () => {
    const colours = yearColours([2023, 2024, 2025, 2026], 2025, theme);
    expect(colours.get(2025)).toBe(theme.accent);
    expect(colours.get(2026)).toBe(theme.run); // newest of the others first
    expect(colours.get(2024)).toBe(theme.strength);
    expect(colours.get(2023)).toBe(theme.row);
    expect(new Set(colours.values()).size).toBe(4);
  });

  it('never gives another year the accent, in any theme', () => {
    for (const t of Object.values(themes)) {
      const colours = yearColours([2022, 2023, 2024, 2025, 2026], 2026, t);
      for (const year of [2022, 2023, 2024, 2025]) expect(colours.get(year)).not.toBe(t.accent);
    }
  });
});
