/**
 * ECharts, loaded on demand and only with the parts Zankup uses, with one theme registered per Zankup
 * theme (generated from the tokens). Imported dynamically, so it stays out of the first load.
 */
import { chartTheme, themes, THEMES } from '@zankup/core';
import { BarChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  BrushComponent,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  ToolboxComponent,
  TooltipComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';

echarts.use([
  LineChart,
  BarChart,
  ScatterChart, // the comparison with Strava (OS-323)
  GridComponent,
  TooltipComponent,
  MarkAreaComponent,
  MarkLineComponent,
  BrushComponent,
  ToolboxComponent, // the brush needs it, even hidden
  SVGRenderer,
]);
for (const name of THEMES) echarts.registerTheme(`zankup-${name}`, chartTheme(themes[name]));

export { echarts };
