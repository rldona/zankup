import { describe, expect, it } from 'vitest';

import { formatters } from '../format';
import { message } from '../i18n';
import { activityCharts, chartValue, rangeOf } from './charts';

const t = (key: Parameters<typeof message>[1], values?: Record<string, string | number>) =>
  message('en', key, values);
const format = formatters({ units: 'metric', locale: 'en' } as never);

describe('the activity charts (OS-907)', () => {
  const series = {
    t: [0, 10, 20, 30],
    dist: [0, 50, 100, 150],
    alt: [100, 110, 120, 115],
    hr: [120, 140, 150, 145],
    speed: [5, 5, 5, 5],
    power: [200, 250, 300, 250],
    cad: [85, 90, 90, 88],
  };

  it('gives a ride its power, speed, cadence and altitude, in that order, and no heart rate', () => {
    const charts = activityCharts(series, {
      sport: 'ride',
      pace: false,
      units: 'metric',
      format,
      t,
      locale: 'en',
    });
    expect(charts.map((c) => c.key)).toEqual(['power', 'speed', 'cad', 'alt']);
    expect(charts[0]?.colour).toBe('power');
    expect(charts[1]?.values[0]).toBe(18); // 5 m/s in km/h
  });

  it("gives a run its pace upside down, with the activity's own figures in the footers", () => {
    const activity = { avg_hr: 142, max_hr: 151, ascent_m: 20, descent_m: 5 } as never;
    const charts = activityCharts(series, {
      sport: 'run',
      pace: true,
      units: 'metric',
      format,
      t,
      locale: 'en',
      activity,
    });
    const pace = charts.find((c) => c.key === 'pace');
    expect(pace?.inverted).toBe(true);
    expect(pace?.values[0]).toBeCloseTo(1000 / 5 / 60);
    expect(charts.find((c) => c.key === 'hr')?.footer[0]).toEqual(['Average', '142 bpm']);
    expect(charts.find((c) => c.key === 'alt')?.footer.map(([label]) => label)).toEqual([
      'Ascent',
      'Descent',
      'Minimum',
      'Maximum',
    ]);
  });

  it('writes a value as its readout does', () => {
    expect(chartValue({ readout: { kind: 'pace', suffix: ' /km' } }, 4.999, 'en')).toBe('5:00 /km');
    expect(chartValue({ readout: { kind: 'dec1', suffix: ' km/h' } }, 24.56, 'en')).toBe('24.6 km/h');
    expect(chartValue({ readout: { kind: 'int', suffix: ' W' } }, 251.4, 'en')).toBe('251 W');
  });
});

describe('the chart range', () => {
  it('reaches a real fast stretch, and leaves out a lone spike', () => {
    const ride = [...Array.from({ length: 980 }, () => 10), ...Array.from({ length: 20 }, () => 24)];
    expect(rangeOf(ride, true)).toEqual([0, 24]);
    const glitch = [...Array.from({ length: 999 }, () => 10), 90];
    expect(rangeOf(glitch, true)[1]).toBe(10);
  });
});
