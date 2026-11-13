import { commonTokens, THEMES, themes, type ThemeName } from '@zankup/core';
import { useMemo } from 'react';

import { EChart } from '../charts/EChart';
import { Sparkline } from '../charts/Sparkline';
import { RouteShape, ZoneBar } from '../charts/static';
import { t } from '../i18n';

// A loop drawn as an encoded polyline, and made-up figures: the catalogue shows components, not data.
const ROUTE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@~b_\\nlrCn{tKgcaD';
const WEEKS = [32, 41, 28, 45, 52, 38, 61, 47, 55, 43, 58, 64];
const ZONES = [300, 900, 1500, 600, 120];

/**
 * Chart catalogue (OS-215): one example of each kind in every theme. Static charts are plain SVG
 * with CSS variables; passive and active ones are ECharts with the theme generated from the tokens.
 * Each block carries its own data-theme, so it is drawn in that theme whatever the page uses.
 */
export function Catalogue() {
  return (
    <section className="page catalogue">
      <h1>Chart catalogue</h1>
      <p className="note">
        Static (SVG), passive (a chart to read) and active (hover and select) in every theme.
      </p>
      {THEMES.map((name) => (
        <ThemeBlock key={name} name={name} />
      ))}
    </section>
  );
}

function ThemeBlock({ name }: { name: ThemeName }) {
  const tokens = themes[name];
  const passive = useMemo(
    () => ({
      grid: { left: 36, right: 8, top: 10, bottom: 22 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: WEEKS.map((_, i) => `W${i + 1}`) },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: WEEKS, itemStyle: { color: tokens.accent, borderRadius: [3, 3, 0, 0] } }],
    }),
    [tokens],
  );
  const active = useMemo(
    () => ({
      grid: { left: 36, right: 8, top: 10, bottom: 22 },
      tooltip: { trigger: 'axis' },
      toolbox: { show: false },
      brush: { xAxisIndex: 0, brushType: 'lineX' },
      xAxis: { type: 'value', min: 0, max: 100 },
      yAxis: { type: 'value' },
      series: [
        {
          type: 'line',
          symbol: 'none',
          data: Array.from({ length: 101 }, (_, i) => [i, 140 + 20 * Math.sin(i / 8) + (i % 7)]),
          lineStyle: { color: commonTokens.zone5 },
        },
      ],
    }),
    [],
  );
  return (
    <div className="panel cat" data-theme={name}>
      <div className="ph">
        <h2>{t(`theme.${name}`)}</h2>
      </div>
      <div className="catgrid">
        <figure>
          <figcaption className="note">ECharts · sparkline</figcaption>
          <Sparkline values={WEEKS} label="Weekly distance trend" />
        </figure>
        <figure>
          <figcaption className="note">Static · zone bar</figcaption>
          <ZoneBar seconds={ZONES} label="Time in heart rate zones" />
        </figure>
        <figure>
          <figcaption className="note">Static · route</figcaption>
          <RouteShape route={ROUTE} label="Route shape" colour={tokens.run} />
        </figure>
        <figure>
          <figcaption className="note">Passive · weekly bars</figcaption>
          <EChart option={passive} theme={name} height={140} summary="Distance per week over 12 weeks" />
        </figure>
        <figure>
          <figcaption className="note">Active · hover and drag</figcaption>
          <EChart option={active} theme={name} height={140} summary="Heart rate over an activity" />
        </figure>
      </div>
    </div>
  );
}
