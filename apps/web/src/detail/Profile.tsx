import {
  commonTokens,
  fillGaps,
  formatDuration,
  metricValues,
  nearestIndex,
  quantile,
  sampleIndices,
  themes,
  xAxis,
  type Metric,
  type Series,
  type ThemeName,
} from '@zankup/core';
import type { EChartsType } from 'echarts/core';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { EChart } from '../charts/EChart';
import { t } from '../i18n';
import { METRIC_COLOUR } from './metrics';

const MAX_POINTS = 1000;
const METRES_PER_MILE = 1609.344;

/**
 * The profile (OS-207): altitude as a shaded area and the chosen metric as a line, over distance (or
 * time when there is none). Hovering moves the cursor on the map; dragging picks a section (OS-216).
 */
export function Profile({
  series,
  metric,
  pace,
  units,
  theme,
  hover,
  section,
  onHover,
  onSection,
  format,
}: {
  series: Series;
  metric: Metric | null;
  pace: boolean;
  units: 'metric' | 'imperial';
  theme: ThemeName;
  hover: number | null;
  section: [number, number] | null;
  onHover: (index: number | null) => void;
  onSection: (range: [number, number] | null) => void;
  format: (metric: Metric, value: number) => string;
}) {
  const axis = useMemo(() => xAxis(series), [series]);
  const scale = axis.kind === 'dist' ? (units === 'metric' ? 1000 : METRES_PER_MILE) : 60;
  const paceUnit = units === 'metric' ? 1000 : METRES_PER_MILE;
  const kept = useMemo(() => sampleIndices(series.t.length, MAX_POINTS), [series]);
  const tokens = useMemo(() => ({ ...commonTokens, ...themes[theme] }), [theme]);

  const option = useMemo(() => {
    const x = (i: number) => (axis.values[i] ?? 0) / scale;
    const alt = series.alt ? fillGaps(series.alt) : null;
    const raw = metric && metric !== 'alt' ? metricValues(series, metric) : null;
    // Pace is time per distance: plotted as seconds per km (or mile), with the axis upside down.
    const value = (v: number | null | undefined) =>
      v == null ? null : metric === 'speed' && pace ? (v > 0.5 ? paceUnit / v : null) : v;
    const values = raw ? kept.map((i) => value(raw[i])) : null;
    const lo = values ? quantile(values, 0.02) : null;
    const hi = values ? quantile(values, 0.98) : null;
    const pad = lo != null && hi != null ? (hi - lo) * 0.1 || 1 : 0;
    const colour = metric ? tokens[METRIC_COLOUR[metric] as keyof typeof tokens] : tokens.accent;
    const altLo = alt ? Math.min(...alt) : 0;
    const altHi = alt ? Math.max(...alt) : 1;
    return {
      grid: { left: 48, right: 12, top: 12, bottom: 26 },
      toolbox: { show: false },
      tooltip: { trigger: 'axis', showContent: false, axisPointer: { type: 'line' } },
      brush: {
        xAxisIndex: 0,
        brushType: 'lineX',
        brushMode: 'single',
        removeOnClick: true,
        transformable: false,
      },
      xAxis: {
        type: 'value',
        min: 0,
        max: x(axis.values.length - 1),
        axisLabel: {
          formatter: (v: number) => (axis.kind === 'dist' ? `${Math.round(v)}` : formatDuration(v * 60)),
        },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          inverse: metric === 'speed' && pace,
          min: lo == null ? undefined : Math.floor(lo - pad),
          max: hi == null ? undefined : Math.ceil(hi + pad),
          axisLabel: {
            formatter: (v: number) =>
              metric ? format(metric, metric === 'speed' && pace ? paceUnit / v : v) : '',
            hideOverlap: true,
          },
          show: values != null,
        },
        {
          type: 'value',
          min: altLo - (altHi - altLo) * 0.05,
          max: altHi + (altHi - altLo) * 1.2,
          show: false,
        },
      ],
      series: [
        {
          type: 'line',
          yAxisIndex: 1,
          silent: true,
          symbol: 'none',
          data: alt ? kept.map((i) => [x(i), alt[i]]) : [],
          lineStyle: { width: metric === 'alt' ? 1.5 : 0, color: tokens.muted },
          areaStyle: { color: tokens.line, opacity: 0.6 },
        },
        {
          type: 'line',
          symbol: 'none',
          data: values ? kept.map((i, k) => [x(i), values[k]]) : [],
          lineStyle: { width: 1.6, color: colour },
          markArea: section
            ? {
                silent: true,
                itemStyle: { color: tokens.fg, opacity: 0.08 },
                data: [[{ xAxis: x(section[0]) }, { xAxis: x(section[1]) }]],
              }
            : undefined,
        },
      ],
    };
  }, [axis, scale, paceUnit, series, metric, pace, kept, tokens, section, format]);

  // Where the chart's own cursor is, so a hover coming from the map is not sent back to it.
  const shown = useRef<number | null>(null);
  const handlers = useRef({ onHover, onSection });
  useEffect(() => {
    handlers.current = { onHover, onSection };
  });

  const wire = useCallback(
    (chart: EChartsType) => {
      chart.dispatchAction({
        type: 'takeGlobalCursor',
        key: 'brush',
        brushOption: { brushType: 'lineX', brushMode: 'single' },
      });
      const toIndex = (v: number) => nearestIndex(axis.values, v * scale);
      const pointer = (event: { axesInfo?: { axisDim: string; value: number }[] }) => {
        const info = event.axesInfo?.find((a) => a.axisDim === 'x');
        if (!info) return;
        const index = toIndex(info.value);
        if (index !== shown.current) {
          shown.current = index;
          handlers.current.onHover(index);
        }
      };
      const brushed = (event: { areas?: { coordRange?: number[] }[] }) => {
        const range = event.areas?.[0]?.coordRange;
        if (!range || range.length < 2) return handlers.current.onSection(null);
        const [a, b] = [toIndex(range[0] ?? 0), toIndex(range[1] ?? 0)];
        handlers.current.onSection(b > a ? [a, b] : null);
        chart.dispatchAction({ type: 'brush', areas: [] }); // the shaded section stays as a markArea
      };
      const out = () => {
        shown.current = null;
        handlers.current.onHover(null);
      };
      chart.on('updateAxisPointer', pointer as never);
      chart.on('brushEnd', brushed as never);
      chart.getZr().on('globalout', out);
      return () => {
        chart.off('updateAxisPointer');
        chart.off('brushEnd');
        chart.getZr().off('globalout', out);
      };
    },
    [axis, scale],
  );

  // A hover from the map: move the chart's cursor there too.
  const chartRef = useRef<EChartsType | null>(null);
  const ready = useCallback(
    (chart: EChartsType) => {
      chartRef.current = chart;
      return wire(chart);
    },
    [wire],
  );
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || hover === shown.current) return;
    shown.current = hover;
    const k = hover == null ? -1 : nearestIndex(kept, hover);
    chart.dispatchAction(k < 0 ? { type: 'hideTip' } : { type: 'showTip', seriesIndex: 1, dataIndex: k });
  }, [hover, kept]);

  const range = useMemo(() => {
    const values = metric ? metricValues(series, metric) : null;
    const lo = values ? quantile(values, 0.02) : null;
    const hi = values ? quantile(values, 0.98) : null;
    return metric && lo != null && hi != null ? { min: format(metric, lo), max: format(metric, hi) } : null;
  }, [series, metric, format]);

  return (
    <EChart
      className="profile"
      option={option}
      theme={theme}
      height={190}
      onReady={ready}
      summary={
        range && metric
          ? t('activity.profileSummary', { metric: t(`metric.${metric}`), ...range })
          : t('activity.profile')
      }
    />
  );
}
