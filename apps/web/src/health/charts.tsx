import { commonTokens, themes, type HealthDay, type ThemeName } from '@zankup/core';
import { useMemo } from 'react';

import { EChart } from '../charts/EChart';
import { locale, t } from '../i18n';

const palette = (theme: ThemeName) => ({ ...commonTokens, ...themes[theme] });
const hours = (s: number | null | undefined) => (s ? +(s / 3600).toFixed(2) : 0);
const label = (day: string) => day.slice(5);

/** Nights as stacked bars (deep, REM, light, awake, in hours) with the sleep score as a line. */
export function SleepChart({ days, theme }: { days: HealthDay[]; theme: ThemeName }) {
  const c = palette(theme);
  const nights = useMemo(() => days.filter((d) => d.sleep), [days]);
  const option = useMemo(() => {
    const stack = (name: string, color: string, pick: (d: HealthDay) => number) => ({
      name,
      type: 'bar',
      stack: 'sleep',
      data: nights.map(pick),
      itemStyle: { color },
      barMaxWidth: 18,
    });
    const asleep = (d: HealthDay) => hours(d.sleep?.asleep_s);
    const staged = (d: HealthDay) => d.sleep?.deep_s != null;
    return {
      grid: { left: 36, right: 36, top: 30, bottom: 26 },
      legend: { top: 0 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: nights.map((d) => label(d.day)), axisLabel: { hideOverlap: true } },
      yAxis: [
        { type: 'value', name: 'h', max: (v: { max: number }) => Math.max(9, Math.ceil(v.max)) },
        { type: 'value', min: 0, max: 100, splitLine: { show: false } },
      ],
      series: [
        stack(t('health.stage.deep'), c.sleepDeep, (d) => hours(d.sleep?.deep_s)),
        stack(t('health.stage.rem'), c.sleepRem, (d) => hours(d.sleep?.rem_s)),
        stack(t('health.stage.light'), c.sleepLight, (d) =>
          staged(d) ? hours(d.sleep?.light_s) : asleep(d),
        ),
        stack(t('health.stage.awake'), c.sleepAwake, (d) => hours(d.sleep?.awake_s)),
        {
          name: t('health.score'),
          type: 'line',
          yAxisIndex: 1,
          symbol: 'circle',
          symbolSize: 4,
          data: nights.map((d) => d.sleep?.score ?? null),
          lineStyle: { color: c.fg, width: 1.5 },
          itemStyle: { color: c.fg },
        },
      ],
    };
  }, [nights, c]);
  const last = nights.at(-1)?.sleep;
  return (
    <EChart
      option={option}
      theme={theme}
      height={240}
      summary={
        last
          ? t('health.sleepSummary', {
              hours: hours(last.asleep_s).toLocaleString(locale, { maximumFractionDigits: 1 }),
              score: last.score ?? '–',
            })
          : t('health.empty')
      }
    />
  );
}

/** HRV and resting heart rate, each on its own axis. */
export function HeartChart({ days, theme }: { days: HealthDay[]; theme: ThemeName }) {
  const c = palette(theme);
  const option = useMemo(
    () => ({
      grid: { left: 40, right: 40, top: 30, bottom: 26 },
      legend: { top: 0 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: days.map((d) => label(d.day)), axisLabel: { hideOverlap: true } },
      yAxis: [
        { type: 'value', name: 'ms', scale: true },
        { type: 'value', name: 'bpm', scale: true, splitLine: { show: false } },
      ],
      series: [
        {
          name: t('health.hrv'),
          type: 'line',
          connectNulls: true,
          symbol: 'none',
          data: days.map((d) => d.hrv?.value.toFixed(0) ?? null),
          lineStyle: { color: c.hrv, width: 2 },
          itemStyle: { color: c.hrv },
        },
        {
          name: t('health.restingHr'),
          type: 'line',
          yAxisIndex: 1,
          connectNulls: true,
          symbol: 'none',
          data: days.map((d) => d.resting_hr?.value.toFixed(0) ?? null),
          lineStyle: { color: c.zone5, width: 1.5 },
          itemStyle: { color: c.zone5 },
        },
      ],
    }),
    [days, c],
  );
  const last = days.at(-1);
  return (
    <EChart
      option={option}
      theme={theme}
      height={220}
      summary={
        last
          ? `${t('health.hrv')} ${last.hrv?.value.toFixed(0) ?? '–'} ms, ${t('health.restingHr')} ${last.resting_hr?.value.toFixed(0) ?? '–'} bpm`
          : t('health.empty')
      }
    />
  );
}

/** Readiness as a line, with the form (TSB) from training as bars. */
export function ReadinessChart({ days, theme }: { days: HealthDay[]; theme: ThemeName }) {
  const c = palette(theme);
  const option = useMemo(
    () => ({
      grid: { left: 36, right: 36, top: 30, bottom: 26 },
      legend: { top: 0 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: days.map((d) => label(d.day)), axisLabel: { hideOverlap: true } },
      yAxis: [
        { type: 'value', min: 0, max: 100 },
        { type: 'value', splitLine: { show: false } },
      ],
      series: [
        {
          name: t('health.readiness'),
          type: 'line',
          connectNulls: true,
          symbol: 'none',
          data: days.map((d) => d.readiness?.score ?? null),
          lineStyle: { color: c.accent, width: 2 },
          itemStyle: { color: c.accent },
          areaStyle: { color: c.accentSoft, opacity: 0.6 },
        },
        {
          name: t('stats.tsb'),
          type: 'bar',
          yAxisIndex: 1,
          data: days.map((d) =>
            d.tsb == null
              ? null
              : {
                  value: d.tsb.toFixed(1),
                  itemStyle: { color: d.tsb >= 0 ? c.formPositive : c.formNegative },
                },
          ),
          barWidth: '50%',
        },
      ],
    }),
    [days, c],
  );
  const last = days.at(-1);
  return (
    <EChart
      option={option}
      theme={theme}
      height={220}
      summary={last?.readiness ? `${t('health.readiness')} ${last.readiness.score}` : t('health.noReadiness')}
    />
  );
}
