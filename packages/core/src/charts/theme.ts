/**
 * Chart theme generated from a Zankup theme (OS-215): the same tokens as the interface, so charts
 * change with the theme. A plain object in ECharts' theme format, with no dependency on ECharts.
 */
import type { Theme } from '../tokens';
import { alpha } from '../map/colour';

export function chartTheme(theme: Theme) {
  const axis = {
    axisLine: { show: true, lineStyle: { color: theme.line } },
    axisTick: { show: false },
    axisLabel: { color: theme.muted, fontSize: 11 },
    splitLine: { show: true, lineStyle: { color: theme.line, type: 'dashed' as const } },
  };
  return {
    color: [theme.accent, theme.ride, theme.run, theme.strength, theme.walk, theme.swim, theme.row],
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
