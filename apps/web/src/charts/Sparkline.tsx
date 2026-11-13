import { themes } from '@zankup/core';
import { useMemo } from 'react';

import { useResolvedTheme } from '../theme';
import { EChart } from './EChart';

/**
 * A small trend line (ECharts, as every chart with data): no axes, the theme's accent unless told
 * otherwise, and the value under the pointer in a tooltip.
 */
export function Sparkline({
  values,
  label,
  colour,
  height = 40,
}: {
  values: number[];
  label: string;
  colour?: string;
  height?: number;
}) {
  const theme = useResolvedTheme();
  const stroke = colour ?? themes[theme].accent;
  const option = useMemo(
    () => ({
      grid: { left: 2, right: 2, top: 4, bottom: 4 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', show: false, data: values.map((_, i) => i + 1) },
      yAxis: { type: 'value', show: false, scale: true },
      series: [
        {
          type: 'line',
          data: values,
          symbol: 'none',
          smooth: 0.3,
          lineStyle: { color: stroke, width: 1.8 },
          areaStyle: { color: stroke, opacity: 0.1 },
        },
      ],
    }),
    [values, stroke],
  );
  return <EChart option={option} theme={theme} height={height} summary={label} className="spark" />;
}
