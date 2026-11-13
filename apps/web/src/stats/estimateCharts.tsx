import { commonTokens, themes, type ThemeName } from '@zankup/core';
import { useMemo } from 'react';

import { EChart } from '../charts/EChart';
import { t } from '../i18n';
import { day } from './format';

export type Point = { day: string; value: number };

const today = () => new Date().toISOString().slice(0, 10);

/** Round steps for an axis of times (race predictions): 53:00, 54:00… rather than 53:20, 54:10. */
const TIME_STEPS = [10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
function timeAxis(values: number[]) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const step = TIME_STEPS.find((s) => s >= (hi - lo) / 4) ?? 3600;
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step, interval: step };
}

/**
 * How an estimate moved (Estimates, OS-913): a step line, as an estimate holds its value until the
 * next one, carried on to today. `compact` is the card's (no axes, a tooltip on hover); otherwise the
 * full chart with its axes. `inverse` puts lower values on top (race times: up is faster).
 */
export function TrendChart({
  points,
  name,
  theme,
  show,
  compact = false,
  inverse = false,
  times = false,
  height,
}: {
  points: Point[];
  name: string;
  theme: ThemeName;
  show: (value: number) => string;
  compact?: boolean;
  inverse?: boolean;
  /** Values are durations in seconds: the axis steps by round minutes. */
  times?: boolean;
  height?: number;
}) {
  const c = { ...commonTokens, ...themes[theme] };
  const option = useMemo(() => {
    const last = points.at(-1);
    const data = points.map((p) => [p.day, p.value]);
    if (last && last.day < today()) data.push([today(), last.value]);
    return {
      grid: compact ? { left: 2, right: 2, top: 6, bottom: 2 } : { left: 64, right: 16, top: 14, bottom: 28 },
      tooltip: {
        trigger: 'axis',
        formatter: (params: { value: [string, number] }[]) => {
          const [when, value] = params[0]?.value ?? ['', 0];
          return `${day(when)}<br/><b>${show(value)}</b>`;
        },
      },
      xAxis: {
        type: 'time',
        show: !compact,
        axisLabel: { hideOverlap: true },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        show: !compact,
        scale: true,
        inverse,
        splitNumber: 4,
        ...(times && points.length ? timeAxis(points.map((p) => p.value)) : {}),
        axisLabel: { formatter: (v: number) => show(v) },
      },
      series: [
        {
          name,
          type: 'line',
          step: 'end',
          data,
          symbol: compact ? 'none' : 'circle',
          symbolSize: 6,
          showSymbol: !compact,
          lineStyle: { color: c.accent, width: compact ? 1.8 : 2 },
          itemStyle: { color: c.accent },
          areaStyle: { color: c.accent, opacity: compact ? 0.1 : 0.12, origin: inverse ? 'end' : 'start' },
        },
      ],
    };
  }, [points, name, show, compact, inverse, times, c.accent]);
  const first = points[0];
  const last = points.at(-1);
  return (
    <EChart
      option={option}
      theme={theme}
      height={height ?? (compact ? 56 : 240)}
      className={compact ? 'trend compact' : 'trend'}
      summary={
        first && last
          ? t('estimate.trendSummary', { name, first: show(first.value), last: show(last.value) })
          : name
      }
    />
  );
}
