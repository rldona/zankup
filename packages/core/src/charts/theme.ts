/**
 * Chart theme generated from a Zankup theme (OS-215): the same tokens as the interface, so charts
 * change with the theme. A plain object in ECharts' theme format, with no dependency on ECharts.
 */
import type { Theme } from '../tokens';
import { alpha } from '../map/colour';

/** The colours a chart gives its series in turn: the accent first, then the sports' own. */
export function seriesColours(theme: Theme): string[] {
  return [theme.accent, theme.ride, theme.run, theme.strength, theme.walk, theme.swim, theme.row];
}

/** The hue of a `#rrggbb` colour, in degrees. */
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const apart = (a: string, b: string) => {
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 360 - d) >= 40;
};

/**
 * One colour per year on "Year by year": the year being looked at gets the accent, the others the
 * sports' colours, newest first, leaving out any whose hue is close to the accent's or to one already
 * given (whatever the theme's accent is), so no two lines look alike.
 */
export function yearColours(years: number[], selected: number, theme: Theme): Map<number, string> {
  const picked = [theme.accent];
  for (const colour of [theme.run, theme.strength, theme.row, theme.ride, theme.swim, theme.walk]) {
    if (picked.every((p) => apart(p, colour))) picked.push(colour);
  }
  const rest = picked.slice(1);
  const others = [...years].filter((y) => y !== selected).sort((a, b) => b - a);
  const colours = new Map<number, string>([[selected, theme.accent]]);
  others.forEach((year, i) => colours.set(year, rest[i % rest.length] ?? theme.muted));
  return colours;
}

export function chartTheme(theme: Theme) {
  const axis = {
    axisLine: { show: true, lineStyle: { color: theme.line } },
    axisTick: { show: false },
    axisLabel: { color: theme.muted, fontSize: 11 },
    splitLine: { show: true, lineStyle: { color: theme.line, type: 'dashed' as const } },
  };
  return {
    color: seriesColours(theme),
    backgroundColor: 'transparent',
    textStyle: { color: theme.fg, fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
    categoryAxis: { ...axis, splitLine: { show: false } },
    valueAxis: axis,
    timeAxis: axis,
    tooltip: {
      backgroundColor: theme.surface,
      borderColor: theme.line,
      textStyle: { color: theme.fg, fontSize: 12 },
      axisPointer: { lineStyle: { color: theme.muted }, crossStyle: { color: theme.muted } },
    },
    legend: { textStyle: { color: theme.muted } },
    brush: { brushStyle: { color: alpha(theme.accent, 0.15), borderColor: theme.accent, borderWidth: 1 } },
  };
}

export type ChartTheme = ReturnType<typeof chartTheme>;
