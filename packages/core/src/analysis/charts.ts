/**
 * The activity's charts, one card each (OS-907, as the app's since OS-518): which metrics an activity
 * has, each in the unit it is read in, with its colour, how its readout is written and the figures in
 * its footer. Shared by the app (Skia) and the web (ECharts), which only draw them.
 */
import type { ActivityDetail } from '../api/queries';
import type { Sport } from '../domain/sports';
import type { formatters } from '../format';
import type { MessageKey } from '../i18n';
import { metricValues, smooth, type Series } from './streams';

type Format = ReturnType<typeof formatters>;
type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/** Power in a light violet on every theme: the ride's blue and speed's accent can both be blue (Ocean). */
export const POWER_COLOUR = '#b197fc';

export type ChartKey = 'power' | 'speed' | 'pace' | 'cad' | 'alt' | 'hr';

/** A theme token, or `power` for POWER_COLOUR. */
export type ChartColour = 'muted' | 'accent' | 'zone5' | 'zone4' | 'power';

export type ActivityChart = {
  key: ChartKey;
  label: string;
  colour: ChartColour;
  /** One value per sample, in the unit the axis shows (null where there is none). */
  values: (number | null)[];
  /** How a value is written: whole, one decimal or m:ss, and what follows it. */
  readout: { kind: 'int' | 'dec1' | 'pace'; suffix: string };
  /** Lower is better (a pace): the axis runs upside down, so faster is higher. */
  inverted?: boolean;
  /** Keep the axis on zero (power, speed); otherwise it hugs the values. */
  fromZero?: boolean;
  /** Figures under the chart: average, maximum, NP and VI, ascent and descent, best pace, GAP… */
  footer: [string, string][];
};

/** The order the cards come in. */
const ORDER: ChartKey[] = ['power', 'speed', 'pace', 'cad', 'alt', 'hr'];

/**
 * The charts an activity has data for: power, speed (or pace), cadence, altitude and heart rate (left
 * out of a ride, which has its zones).
 */
export function activityCharts(
  series: Series,
  {
    sport,
    pace,
    units,
    format,
    activity: a,
    t,
    locale,
  }: {
    sport: Sport;
    pace: boolean;
    units: 'metric' | 'imperial';
    format: Format;
    activity?: ActivityDetail;
    t: Translate;
    locale: string;
  },
): ActivityChart[] {
  const usable = (values: (number | null)[]) => values.filter((v): v is number => v != null && v > 0);
  const maxOf = (values: (number | null)[]) => Math.max(...usable(values));
  const minOf = (values: (number | null)[]) => Math.min(...values.filter((v): v is number => v != null));
  const avgOf = (values: (number | null)[]) => {
    const u = usable(values);
    return u.length ? u.reduce((x, y) => x + y, 0) / u.length : 0;
  };
  const has = (values: (number | null)[] | null | undefined): values is (number | null)[] =>
    !!values?.some((v) => v != null && v > 0);
  const out: ActivityChart[] = [];
  const feet = units === 'imperial' ? 3.28084 : 1;
  const unit = units === 'imperial' ? 1609.344 : 1000;

  const alt = series.alt;
  if (alt?.some((v) => v != null)) {
    const highest = Math.max(...alt.filter((v): v is number => v != null));
    out.push({
      key: 'alt',
      label: t('metric.alt'),
      colour: 'muted',
      values: alt.map((v) => (v == null ? null : v * feet)),
      readout: { kind: 'int', suffix: units === 'imperial' ? ' ft' : ' m' },
      footer: [
        ...(a?.ascent_m != null
          ? ([[t('chart.ascent'), format.elevation(a.ascent_m)]] as [string, string][])
          : []),
        ...(a?.descent_m != null
          ? ([[t('chart.descent'), format.elevation(a.descent_m)]] as [string, string][])
          : []),
        [t('chart.min'), format.elevation(minOf(alt))],
        [t('chart.maxFull'), format.elevation(highest)],
      ],
    });
  }

  const speed = metricValues(series, 'speed');
  if (has(speed)) {
    const text = (v: number) => format.speedFor(v, pace);
    const moving = speed.filter((v): v is number => v != null && v > 0.5);
    const mean = moving.length ? moving.reduce((x, y) => x + y, 0) / moving.length : 0;
    out.push(
      pace
        ? {
            key: 'pace',
            label: t('metric.pace'),
            colour: 'accent',
            // Minutes per km (or mile); standing still has no pace.
            values: speed.map((v) => (v == null || v < 0.5 ? null : unit / v / 60)),
            readout: { kind: 'pace', suffix: units === 'imperial' ? ' /mi' : ' /km' },
            inverted: true,
            footer: [
              [t('chart.avgFull'), mean ? text(mean) : '–'],
              [t('chart.bestPace'), moving.length ? text(Math.max(...moving)) : '–'],
              ...(a?.metrics?.gap_speed
                ? ([[t('chart.gap'), format.pace(a.metrics.gap_speed)]] as [string, string][])
                : []),
            ],
          }
        : {
            key: 'speed',
            label: t('metric.speed'),
            colour: 'accent',
            values: speed.map((v) => (v == null ? null : (v * 3600) / unit)),
            readout: { kind: 'dec1', suffix: units === 'imperial' ? ' mph' : ' km/h' },
            fromZero: true,
            footer: [
              [t('chart.avgFull'), mean ? text(mean) : '–'],
              [t('chart.maxFull'), moving.length ? text(Math.max(...moving)) : '–'],
            ],
          },
    );
  }

  const hr = series.hr;
  if (has(hr)) {
    const text = (v: number) => `${Math.round(v)} bpm`;
    out.push({
      key: 'hr',
      label: t('metric.hr'),
      colour: 'zone5',
      values: hr,
      readout: { kind: 'int', suffix: ' bpm' },
      footer: [
        [t('chart.avgFull'), text(a?.avg_hr ?? avgOf(hr))],
        [t('chart.maxFull'), text(a?.max_hr ?? maxOf(hr))],
        ...(a?.metrics?.trimp != null
          ? ([[t('chart.effort'), Math.round(a.metrics.trimp).toLocaleString(locale)]] as [string, string][])
          : []),
      ],
    });
  }

  const power = metricValues(series, 'power');
  if (has(power)) {
    const raw = series.power ?? power;
    const text = (v: number) => `${Math.round(v)} W`;
    out.push({
      key: 'power',
      label: t('metric.power'),
      colour: 'power',
      values: power,
      readout: { kind: 'int', suffix: ' W' },
      fromZero: true,
      footer: [
        [t('chart.avgFull'), text(a?.avg_power ?? avgOf(raw))],
        [t('chart.maxFull'), text(maxOf(raw))],
        ...(a?.normalized_power
          ? ([
              [t('chart.np'), text(a.normalized_power)],
              ...(a.avg_power
                ? [
                    [
                      t('chart.vi'),
                      (a.normalized_power / a.avg_power).toLocaleString(locale, { maximumFractionDigits: 2 }),
                    ],
                  ]
                : []),
            ] as [string, string][])
          : []),
      ],
    });
  }

  if (has(series.cad)) {
    const per = sport === 'ride' ? 'rpm' : t('chart.spm');
    const text = (v: number) => `${Math.round(v)} ${per}`;
    out.push({
      key: 'cad',
      label: t('metric.cad'),
      colour: 'zone4',
      values: smooth(series.cad),
      readout: { kind: 'int', suffix: ` ${per}` },
      footer: [
        [t('chart.avgFull'), text(avgOf(series.cad))],
        [t('chart.maxFull'), text(maxOf(series.cad))],
      ],
    });
  }

  return out
    .filter((chart) => sport !== 'ride' || chart.key !== 'hr')
    .sort((x, y) => ORDER.indexOf(x.key) - ORDER.indexOf(y.key));
}

/**
 * The axis range for a chart's values: from zero or the 2nd percentile, up to the maximum, unless a
 * glitch lifts it far above the rest (more than 1.5 × the 98th percentile), when it stops at the 99.5th.
 * So a long descent's top speed is not clipped, and one bad sample does not flatten the chart.
 */
export function rangeOf(values: (number | null)[], fromZero: boolean): [number, number] {
  const sorted = values.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return [0, 1];
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] ?? 0;
  const lo = fromZero ? 0 : at(0.02);
  const max = sorted[sorted.length - 1] ?? 0;
  const p98 = at(0.98);
  const hi = max <= Math.max(p98 * 1.5, p98 + 1) ? max : at(0.995);
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}

/** A chart's value as its readout writes it: "152 bpm", "24.6 km/h", "4:52 /km". */
export function chartValue(chart: Pick<ActivityChart, 'readout'>, v: number, locale: string): string {
  const { kind, suffix } = chart.readout;
  if (kind === 'pace') {
    let minutes = Math.floor(v);
    let seconds = Math.round((v - minutes) * 60);
    if (seconds === 60) {
      minutes += 1;
      seconds = 0;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}${suffix}`;
  }
  const digits = kind === 'dec1' ? 1 : 0;
  return `${v.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`;
}
