import {
  ApiError,
  activityQuery,
  availableMetrics,
  formatActivityDate,
  formatDuration,
  formatters,
  localStart,
  metricValues,
  quantile,
  RAMP,
  sectionStats,
  SPORTS,
  streamsQuery,
  timeInZones,
  trackPoints,
  usesPace,
  ZONE_SHARES,
  zoneLimits,
  type ActivityDetail,
  type Metric,
  type MessageKey,
  type Series,
  type Sport,
  type ThemeName,
  themes,
} from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';

import { api } from '../api';
import { ZoneBar } from '../charts/static';
import { Profile } from '../detail/Profile';
import { RouteMap } from '../detail/RouteMap';
import { locale, t } from '../i18n';
import { usePrefs } from '../prefs';
import { SportIcon } from '../SportIcon';
import { useResolvedTheme } from '../theme';

type Format = ReturnType<typeof formatters>;

const asSport = (value: string): Sport =>
  (SPORTS as readonly string[]).includes(value) ? (value as Sport) : 'other';

/**
 * Activity detail (OS-205 to OS-208, OS-216): header and figures, the route on a map coloured by a
 * metric, the profile synced with the map and a section picked on it, HR zones, best efforts, laps and
 * splits, and the original file.
 */
export function Activity() {
  const id = Number(useParams().id);
  const valid = Number.isInteger(id) && id > 0;
  const activity = useQuery({ ...activityQuery(api, id), enabled: valid });

  if (!valid || (activity.error instanceof ApiError && activity.error.status === 404)) {
    return (
      <section className="page">
        <p className="state">{t('activity.notFound')}</p>
      </section>
    );
  }
  if (activity.isError) {
    return (
      <section className="page">
        <p className="state" role="alert">
          {t('common.error')}
        </p>
      </section>
    );
  }
  if (!activity.data) {
    return (
      <section className="page">
        <p className="state">{t('common.loading')}</p>
      </section>
    );
  }
  return <Detail activity={activity.data} />;
}

function Detail({ activity }: { activity: ActivityDetail }) {
  const prefs = usePrefs();
  const format = useMemo(() => formatters(prefs), [prefs]);
  const sport = asSport(activity.sport);
  const pace = usesPace(sport);
  const streams = useQuery({ ...streamsQuery(api, activity.id), enabled: activity.streams != null });
  const series = streams.data as Series | undefined;

  return (
    <article className="page detail">
      <header className="dhead">
        <SportIcon sport={sport} />
        <div>
          <h1>{activity.name ?? t(`sport.${sport}`)}</h1>
          <p className="csub">
            {formatActivityDate(localStart(activity.start_utc, activity.timezone), locale)}
            {activity.device ? ` · ${activity.device}` : ''}
          </p>
        </div>
      </header>

      <Kpis activity={activity} format={format} pace={pace} />

      {activity.streams && !series && <p className="state">{t('activity.loadingSeries')}</p>}
      {series && <RoutePanel series={series} sport={sport} pace={pace} format={format} units={prefs.units} />}

      {series?.hr?.some((v) => v != null) && (
        <Zones series={series} hrMax={prefs.hrMax} estimated={prefs.hrMaxEstimated} />
      )}
      <BestEfforts activity={activity} format={format} />
      <Laps activity={activity} format={format} pace={pace} />
      <Splits activity={activity} format={format} pace={pace} />

      {activity.description && (
        <section className="panel">
          <p className="desc">{activity.description}</p>
        </section>
      )}
      <p className="note origin">
        {t('activity.origin')}: {sourceLabel(activity.source)}
        {activity.has_fit && (
          <>
            {' · '}
            <a href={`/api/activities/${activity.id}/fit`} download>
              {t('activity.download')}
            </a>
          </>
        )}
      </p>
    </article>
  );
}

function sourceLabel(source: string): string {
  const key = `activity.source.${source}`;
  return key === 'activity.source.garmin' ||
    key === 'activity.source.strava' ||
    key === 'activity.source.manual'
    ? t(key)
    : source;
}

function Kpis({ activity: a, format, pace }: { activity: ActivityDetail; format: Format; pace: boolean }) {
  const moving = a.moving_s ?? a.duration_s;
  const items: [MessageKey, string][] = [];
  if (a.distance_m) items.push(['feed.stat.distance', format.distance(a.distance_m)]);
  items.push(['feed.stat.time', formatDuration(moving)]);
  if (a.moving_s && a.duration_s - a.moving_s > 60)
    items.push(['activity.elapsed', formatDuration(a.duration_s)]);
  if (a.distance_m && moving > 0)
    items.push([pace ? 'feed.stat.pace' : 'feed.stat.speed', format.speedFor(a.distance_m / moving, pace)]);
  if (a.ascent_m) items.push(['feed.stat.ascent', format.elevation(a.ascent_m)]);
  if (a.avg_hr) items.push(['feed.stat.hr', `${a.avg_hr} bpm`]);
  if (a.max_hr) items.push(['activity.maxHr', `${a.max_hr} bpm`]);
  if (a.avg_power) items.push(['activity.power', `${a.avg_power} W`]);
  if (a.normalized_power) items.push(['activity.np', `${a.normalized_power} W`]);
  if (a.calories) items.push(['activity.calories', `${a.calories.toLocaleString(locale)} kcal`]);
  if (a.training_effect)
    items.push(['activity.te', a.training_effect.toLocaleString(locale, { maximumFractionDigits: 1 })]);
  return (
    <dl className="kpis num">
      {items.map(([label, value]) => (
        <div key={label} className="kpi">
          <dd>{value}</dd>
          <dt>{t(label)}</dt>
        </div>
      ))}
    </dl>
  );
}

function RoutePanel({
  series,
  sport,
  pace,
  format,
  units,
}: {
  series: Series;
  sport: Sport;
  pace: boolean;
  format: Format;
  units: 'metric' | 'imperial';
}) {
  const theme = useResolvedTheme();
  const metrics = useMemo(() => availableMetrics(series), [series]);
  const [chosen, setMetric] = useState<Metric | null>(null);
  const metric = chosen && metrics.includes(chosen) ? chosen : (metrics[0] ?? null);
  const [hover, setHover] = useState<number | null>(null);
  const [section, setSection] = useState<[number, number] | null>(null);
  const hasMap = useMemo(() => trackPoints(series).length > 1, [series]);

  const formatMetric = useCallback(
    (m: Metric, v: number) => {
      switch (m) {
        case 'speed':
          return format.speedFor(v, pace);
        case 'hr':
          return `${Math.round(v)} bpm`;
        case 'power':
          return `${Math.round(v)} W`;
        case 'alt':
          return format.elevation(v);
      }
    },
    [format, pace],
  );

  const legend = useMemo(() => {
    const values = metric ? metricValues(series, metric) : null;
    const lo = values ? quantile(values, 0.02) : null;
    const hi = values ? quantile(values, 0.98) : null;
    return metric && lo != null && hi != null && hi > lo
      ? { min: formatMetric(metric, lo), max: formatMetric(metric, hi) }
      : null;
  }, [series, metric, formatMetric]);

  const label = (m: Metric) => t(m === 'speed' ? (pace ? 'metric.pace' : 'metric.speed') : `metric.${m}`);

  return (
    <section className="panel route">
      <div className="ph">
        <h2>{hasMap ? t('activity.route') : t('activity.profile')}</h2>
        {metrics.length > 1 && (
          <div className="seg" role="group" aria-label={t('activity.colourBy')}>
            {metrics.map((m) => (
              <button key={m} type="button" aria-pressed={m === metric} onClick={() => setMetric(m)}>
                {label(m)}
              </button>
            ))}
          </div>
        )}
        {hasMap && legend && (
          <div className="legend num" aria-hidden="true">
            <span>{pace && metric === 'speed' ? legend.max : legend.min}</span>
            <i style={{ background: `linear-gradient(90deg, ${RAMP.join(', ')})` }} />
            <span>{pace && metric === 'speed' ? legend.min : legend.max}</span>
          </div>
        )}
      </div>
      {hasMap && (
        <RouteMap
          series={series}
          metric={metric}
          theme={theme}
          hover={hover}
          section={section}
          onHover={setHover}
          colour={sportColour(theme, sport)}
        />
      )}
      <Profile
        series={series}
        metric={metric}
        pace={pace}
        units={units}
        theme={theme}
        hover={hover}
        section={section}
        onHover={setHover}
        onSection={setSection}
        format={formatMetric}
      />
      <Readout
        series={series}
        hover={hover}
        section={section}
        format={format}
        pace={pace}
        onClear={() => setSection(null)}
      />
    </section>
  );
}

function sportColour(theme: ThemeName, sport: Sport): string {
  return themes[theme][sport];
}

function Readout({
  series,
  hover,
  section,
  format,
  pace,
  onClear,
}: {
  series: Series;
  hover: number | null;
  section: [number, number] | null;
  format: Format;
  pace: boolean;
  onClear: () => void;
}) {
  if (section) {
    const s = sectionStats(series, section[0], section[1]);
    return (
      <div className="readout section num" aria-live="polite">
        <b>{t('activity.section')}</b>
        {s.distance_m != null && <span>{format.distance(s.distance_m)}</span>}
        <span>{formatDuration(s.time_s)}</span>
        {s.speed != null && <span>{format.speedFor(s.speed, pace)}</span>}
        {s.avg_hr != null && <span>{s.avg_hr} bpm</span>}
        {s.avg_power != null && <span>{s.avg_power} W</span>}
        {s.ascent_m != null && (
          <span>
            +{format.elevation(s.ascent_m)} / −{format.elevation(s.descent_m ?? 0)}
          </span>
        )}
        <button type="button" className="link" onClick={onClear}>
          {t('activity.clearSection')}
        </button>
      </div>
    );
  }
  if (hover == null) return <p className="readout note">{t('activity.hint')}</p>;
  const parts: ReactNode[] = [];
  const dist = series.dist?.[hover];
  if (dist != null) parts.push(format.distance(dist));
  parts.push(formatDuration(series.t[hover] ?? 0));
  const speed = metricValues(series, 'speed')?.[hover];
  if (speed != null && speed > 0) parts.push(format.speedFor(speed, pace));
  const hr = series.hr?.[hover];
  if (hr != null) parts.push(`${hr} bpm`);
  const power = series.power?.[hover];
  if (power != null) parts.push(`${power} W`);
  const alt = series.alt?.[hover];
  if (alt != null) parts.push(format.elevation(alt));
  return (
    <p className="readout num">
      {parts.map((p, i) => (
        <span key={i}>{p}</span>
      ))}
    </p>
  );
}

function Zones({ series, hrMax, estimated }: { series: Series; hrMax: number | null; estimated: boolean }) {
  if (!hrMax) {
    return (
      <section className="panel">
        <div className="ph">
          <h2>{t('activity.zones')}</h2>
        </div>
        <p className="note">{t('activity.zonesNone')}</p>
      </section>
    );
  }
  const seconds = timeInZones(series, hrMax);
  const total = seconds.reduce((a, b) => a + b, 0) || 1;
  const limits = zoneLimits(hrMax);
  return (
    <section className="panel zones">
      <div className="ph">
        <h2>{t('activity.zones')}</h2>
      </div>
      <ZoneBar seconds={seconds} label={t('activity.zones')} />
      <table className="num">
        <tbody>
          {seconds.map((s, i) => (
            <tr key={i}>
              <th scope="row">Z{i + 1}</th>
              <td className="track">
                <i style={{ width: `${(s / total) * 100}%`, background: `var(--zone-${i + 1})` }} />
              </td>
              <td className="muted">
                {limits[i]}
                {i < 4 ? `–${(limits[i + 1] ?? 0) - 1}` : '+'} bpm
              </td>
              <td>{formatDuration(s)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">
        {t('activity.zonesNote', {
          low: Math.round((ZONE_SHARES[0] ?? 0) * 100),
          high: Math.round((ZONE_SHARES.at(-1) ?? 0) * 100),
          hrMax,
        })}
        {estimated && ` ${t('activity.zonesEstimate', { hrMax })}`}
      </p>
    </section>
  );
}

const EFFORT_KEYS = new Set([
  '400m',
  'half_mile',
  '1k',
  '1mile',
  '2mile',
  '5k',
  '10k',
  '15k',
  '10mile',
  'half_marathon',
  'marathon',
]);

function BestEfforts({ activity, format }: { activity: ActivityDetail; format: Format }) {
  if (!activity.best_efforts.length) return null;
  return (
    <section className="panel">
      <div className="ph">
        <h2>{t('activity.best')}</h2>
      </div>
      <table className="num">
        <thead>
          <tr>
            <th scope="col">{t('feed.stat.distance')}</th>
            <th scope="col">{t('feed.stat.time')}</th>
            <th scope="col">{t('feed.stat.pace')}</th>
          </tr>
        </thead>
        <tbody>
          {activity.best_efforts.map((e) => (
            <tr key={e.distance_key}>
              <td>
                {EFFORT_KEYS.has(e.distance_key)
                  ? t(`effort.${e.distance_key}` as MessageKey)
                  : format.distance(e.distance_m)}
              </td>
              <td>{formatDuration(e.time_s)}</td>
              <td>{format.pace(e.distance_m / e.time_s)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Laps({ activity, format, pace }: { activity: ActivityDetail; format: Format; pace: boolean }) {
  if (activity.laps.length < 2) return null;
  const power = activity.laps.some((l) => l.avg_power);
  return (
    <section className="panel">
      <div className="ph">
        <h2>{t('activity.laps')}</h2>
      </div>
      <div className="scroll">
        <table className="num">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">{t('feed.stat.distance')}</th>
              <th scope="col">{t('feed.stat.time')}</th>
              <th scope="col">{t(pace ? 'feed.stat.pace' : 'feed.stat.speed')}</th>
              <th scope="col">{t('activity.elev')}</th>
              <th scope="col">{t('feed.stat.hr')}</th>
              {power && <th scope="col">{t('activity.power')}</th>}
            </tr>
          </thead>
          <tbody>
            {activity.laps.map((l) => (
              <tr key={l.idx}>
                <td>{l.idx + 1}</td>
                <td>{l.distance_m ? format.distance(l.distance_m) : '—'}</td>
                <td>{formatDuration(l.duration_s)}</td>
                <td>
                  {l.distance_m && l.duration_s ? format.speedFor(l.distance_m / l.duration_s, pace) : '—'}
                </td>
                <td>
                  {l.ascent_m != null
                    ? `+${format.elevation(l.ascent_m)} / −${format.elevation(l.descent_m ?? 0)}`
                    : '—'}
                </td>
                <td>{l.avg_hr ?? '—'}</td>
                {power && <td>{l.avg_power ? `${l.avg_power} W` : '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Splits({ activity, format, pace }: { activity: ActivityDetail; format: Format; pace: boolean }) {
  if (activity.splits.length < 2) return null;
  const speeds = activity.splits.map((s) => s.distance_m / s.time_s);
  const fastest = Math.max(...speeds);
  return (
    <section className="panel">
      <div className="ph">
        <h2>{t('activity.splits')}</h2>
      </div>
      <table className="num splits">
        <tbody>
          {activity.splits.map((s, i) => (
            <tr key={i}>
              <th scope="row">
                {format.distance(activity.splits.slice(0, i + 1).reduce((a, x) => a + x.distance_m, 0))}
              </th>
              <td>{format.speedFor(s.distance_m / s.time_s, pace)}</td>
              <td className="track">
                <i style={{ width: `${((speeds[i] ?? 0) / fastest) * 100}%` }} />
              </td>
              <td>{s.elevation_change_m != null ? format.elevation(s.elevation_change_m) : ''}</td>
              <td>{s.avg_hr ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
