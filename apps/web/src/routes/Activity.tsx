import {
  activityCharts,
  activityFigures,
  ApiError,
  activityQuery,
  curvesQuery,
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
  effortShown,
} from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';

import { api } from '../api';
import { ZoneBar } from '../charts/static';
import { ChartCard } from '../detail/ChartCard';
import { MapControls } from '../detail/MapControls';
import { useReplay } from '../detail/replay';
import { ActivityActions, Meta, Photos } from '../detail/Tools';
import { RouteMap } from '../detail/RouteMap';
import { Strength } from '../detail/Strength';
import { Summary } from '../detail/Summary';
import { CurveChart } from '../stats/charts';
import { locale, t } from '../i18n';
import { usePrefs } from '../prefs';
import { SportIcon } from '../SportIcon';
import { useResolvedTheme } from '../theme';
import { ActivitySkeleton, ChartSkeleton, Pulse } from '../Skeleton';
import { CardTitle } from '../ui';
import { MaterialIcon } from '../MaterialIcon';
import { DESKTOP, PHONE, useMedia } from '../media';

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
  if (activity.data) return <Detail activity={activity.data} />; // kept offline, even if a refetch failed
  if (activity.isError) {
    return (
      <section className="page">
        <p className="state" role="alert">
          {t('common.error')}
        </p>
      </section>
    );
  }
  return (
    <section className="page">
      <ActivitySkeleton />
    </section>
  );
}

function Detail({ activity }: { activity: ActivityDetail }) {
  const prefs = usePrefs();
  const format = useMemo(() => formatters(prefs), [prefs]);
  const sport = asSport(activity.sport);
  const pace = usesPace(sport);
  const streams = useQuery({ ...streamsQuery(api, activity.id), enabled: activity.streams != null });
  const series = streams.data as Series | undefined;
  // The cursor and the section, shared by the map and every chart.
  const [hover, setHover] = useState<number | null>(null);
  const [section, setSection] = useState<[number, number] | null>(null);
  const hasMap = useMemo(() => (series ? trackPoints(series).length > 1 : false), [series]);
  const hrZones = series?.hr?.some((v) => v != null) && (
    <Zones
      series={series}
      hrMax={prefs.hrMax}
      estimated={prefs.hrMaxEstimated}
      engine={
        activity.metrics?.hr_zones && activity.metrics.hr_zone_bounds
          ? { seconds: activity.metrics.hr_zones, bounds: activity.metrics.hr_zone_bounds }
          : null
      }
    />
  );

  const phone = useMedia(PHONE);
  const desktop = useMedia(DESKTOP);
  const map = series && hasMap && (
    <ActivityMap
      series={series}
      sport={sport}
      pace={pace}
      format={format}
      hover={hover}
      section={section}
      onHover={setHover}
    />
  );
  const summary = <Summary activityId={activity.id} name={activity.name} />;
  const figures = <Figures {...activityFigures(activity, { pace, format, t, locale })} />;
  const charts = (
    <>
      {activity.streams && !series && (
        <Pulse>
          <ChartSkeleton height={280} />
        </Pulse>
      )}
      {series && (
        <ActivityCharts
          series={series}
          sport={sport}
          pace={pace}
          format={format}
          units={prefs.units}
          activity={activity}
          section={section}
          onHover={setHover}
          onSection={setSection}
        />
      )}
    </>
  );
  // The sections in the app's order (OS-909): on a ride the heart-rate zones follow the power curve and
  // zones; on a run the splits follow the heart-rate zones. On a desktop they sit in the main column
  // too, under the power zones; the side column keeps the Coach's summary.
  const rest = (
    <>
      <Photos activityId={activity.id} photos={activity.photo_list ?? []} />
      {sport !== 'ride' && hrZones}
      {sport === 'run' && <Splits activity={activity} format={format} pace={pace} />}
      {/* Kept offline before sets existed, an activity may come without them. */}
      {(activity.sets ?? []).length > 0 && <Strength sets={activity.sets} />}
      <EngineExtras activity={activity} />
      {sport === 'ride' && hrZones}
      <Laps activity={activity} format={format} pace={pace} />
      {sport !== 'run' && <Splits activity={activity} format={format} pace={pace} />}
      {activity.description && (
        <section className="panel">
          <p className="desc">{activity.description}</p>
        </section>
      )}
      <BestEfforts activity={activity} format={format} />
      <p className="note origin">
        {t('activity.origin')}: {sourceLabel(activity.source)}
        {activity.has_fit && (
          <>
            {' · '}
            <a href={`/api/activities/${activity.id}/fit`} download>
              {t('activity.download')}
              {activity.original_format && activity.original_format !== 'fit'
                ? ` (${activity.original_format.toUpperCase()})`
                : ''}
            </a>
          </>
        )}
      </p>
    </>
  );

  return (
    <article className={`page detail${map ? ' withmap' : ''}`}>
      {/* On a phone, as the app's pushed screen: back, edit, share and photos over the map. */}
      {phone && <ActivityActions activity={activity} floating />}
      {/* As on the app: the map across the top, then the title, the figures and the Coach's summary. */}
      {map}
      <header className="dhead">
        <SportIcon sport={sport} />
        <div>
          <h1>{activity.name ?? t(`sport.${sport}`)}</h1>
          <p className="csub">
            {formatActivityDate(localStart(activity.start_utc, activity.timezone), locale)}
            {activity.device ? ` · ${activity.device}` : ''}
          </p>
          <Meta activity={activity} />
        </div>
        {!phone && <ActivityActions activity={activity} />}
      </header>

      {desktop ? (
        // Desktop: the figures at 70 % beside the Coach's summary at 30 %; below, the charts and the
        // rest use the whole width.
        <>
          <div className="detailgrid">
            {figures}
            <aside className="detailside">{summary}</aside>
          </div>
          {charts}
          {rest}
        </>
      ) : (
        <>
          {figures}
          {summary}
          {charts}
          {rest}
        </>
      )}
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

/** The figures under the title (OS-908), as the app's: the six that matter in columns, the rest behind "More". */
function Figures({ main, more }: { main: [string, string][]; more: [string, string][] }) {
  const [open, setOpen] = useState(false);
  const list = (items: [string, string][]) => (
    <dl className="figs num">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <section className="figures" aria-label={t('activity.figures')}>
      {list(main)}
      {more.length > 0 && open && list(more)}
      {more.length > 0 && (
        <button type="button" className="link figmore" aria-expanded={open} onClick={() => setOpen(!open)}>
          {t(open ? 'activity.fig.less' : 'activity.fig.more')}
          <MaterialIcon name={open ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} />
        </button>
      )}
    </section>
  );
}

/** The map with its controls on it (OS-908): replay, what the route is coloured by and its legend. */
function ActivityMap({
  series,
  sport,
  pace,
  format,
  hover,
  section,
  onHover,
}: {
  series: Series;
  sport: Sport;
  pace: boolean;
  format: Format;
  hover: number | null;
  section: [number, number] | null;
  onHover: (index: number | null) => void;
}) {
  const theme = useResolvedTheme();
  const metrics = useMemo(() => availableMetrics(series), [series]);
  const [chosen, setMetric] = useState<Metric | null>(null);
  const metric = chosen && metrics.includes(chosen) ? chosen : (metrics[0] ?? null);
  const replay = useReplay(series, hover, onHover);

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
    if (!metric || lo == null || hi == null || hi <= lo) return null;
    // A pace reads best first: the fast end of the ramp is the low pace.
    const inverted = pace && metric === 'speed';
    return {
      low: formatMetric(metric, inverted ? hi : lo),
      high: formatMetric(metric, inverted ? lo : hi),
      colours: RAMP,
    };
  }, [series, metric, formatMetric, pace]);

  const label = (m: Metric) => t(m === 'speed' ? (pace ? 'metric.pace' : 'metric.speed') : `metric.${m}`);

  return (
    <section className="mapblock" aria-label={t('activity.route')}>
      <RouteMap
        series={series}
        metric={metric}
        theme={theme}
        hover={hover}
        section={section}
        onHover={onHover}
        colour={sportColour(theme, sport)}
      />
      <MapControls
        replay={replay}
        metric={metric}
        metrics={metrics.map((m) => ({ value: m, label: label(m) }))}
        onMetric={setMetric}
        legend={legend}
      />
    </section>
  );
}

/** The activity's charts, each on its own card (OS-907), under one heading with the section switch. */
function ActivityCharts({
  series,
  sport,
  pace,
  format,
  units,
  activity,
  section,
  onHover,
  onSection,
}: {
  series: Series;
  sport: Sport;
  pace: boolean;
  format: Format;
  units: 'metric' | 'imperial';
  activity: ActivityDetail;
  section: [number, number] | null;
  onHover: (index: number | null) => void;
  onSection: (range: [number, number] | null) => void;
}) {
  const theme = useResolvedTheme();
  const [selecting, setSelecting] = useState(false);
  const charts = useMemo(
    () => activityCharts(series, { sport, pace, units, format, activity, t, locale }),
    [series, sport, pace, units, format, activity],
  );
  if (!charts.length) return null;
  return (
    <>
      <div className="titlebar profilehead">
        <h2>{t('activity.profile')}</h2>
        <button
          type="button"
          className="chip"
          aria-pressed={selecting}
          onClick={() => {
            // Turning "Section" off drops the band, its figures and the map's highlight.
            if (selecting) onSection(null);
            setSelecting(!selecting);
          }}
        >
          {t('mobile.selectSection')}
        </button>
      </div>
      {selecting && !section && <p className="note">{t('activity.sectionHint')}</p>}
      <div className="chartgrid">
        {charts.map((chart) => (
          <ChartCard
            key={chart.key}
            chart={chart}
            series={series}
            units={units}
            theme={theme}
            section={section}
            selecting={selecting}
            onHover={onHover}
            onSection={onSection}
          />
        ))}
      </div>
      {section && (
        <SectionFigures
          series={series}
          section={section}
          format={format}
          pace={pace}
          onClear={() => onSection(null)}
          activityId={activity.id}
        />
      )}
    </>
  );
}

function sportColour(theme: ThemeName, sport: Sport): string {
  return themes[theme][sport];
}

/** The selected section's figures, with "save as segment" when it has a track (OS-216, OS-308). */
function SectionFigures({
  series,
  section,
  format,
  pace,
  onClear,
  activityId,
}: {
  series: Series;
  section: [number, number];
  format: Format;
  pace: boolean;
  onClear: () => void;
  activityId: number;
}) {
  const s = sectionStats(series, section[0], section[1]);
  const figures: [string, string][] = [
    ...(s.distance_m != null
      ? ([[t('feed.stat.distance'), format.distance(s.distance_m)]] as [string, string][])
      : []),
    [t('feed.stat.time'), formatDuration(s.time_s)],
    ...(s.speed != null
      ? ([[t(pace ? 'feed.stat.pace' : 'feed.stat.speed'), format.speedFor(s.speed, pace)]] as [
          string,
          string,
        ][])
      : []),
    ...(s.ascent_m != null
      ? ([[t('feed.stat.ascent'), format.elevation(s.ascent_m)]] as [string, string][])
      : []),
    ...(s.avg_hr != null ? ([[t('feed.stat.hr'), `${s.avg_hr} bpm`]] as [string, string][]) : []),
    ...(s.avg_power != null ? ([[t('activity.power'), `${s.avg_power} W`]] as [string, string][]) : []),
  ];
  return (
    <section className="panel sectionfigs" aria-live="polite">
      <CardTitle
        right={
          <button type="button" className="link" onClick={onClear}>
            {t('activity.clearSection')}
          </button>
        }
      >
        {t('activity.section')}
      </CardTitle>
      <dl className="chartfoot num">
        {figures.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {series.lat?.some((v) => v != null) && <SaveSegment activityId={activityId} section={section} />}
    </section>
  );
}

function Zones({
  series,
  hrMax,
  estimated,
  engine,
}: {
  series: Series;
  hrMax: number | null;
  estimated: boolean;
  engine: { seconds: number[]; bounds: number[] } | null;
}) {
  if (!hrMax && !engine) {
    return (
      <section className="panel">
        <CardTitle>{t('activity.zones')}</CardTitle>
        <p className="note">{t('activity.zonesNone')}</p>
      </section>
    );
  }
  // The engine's zones follow your zone model (OS-301); without them, share of max HR here.
  const seconds = engine?.seconds ?? timeInZones(series, hrMax ?? 190);
  const total = seconds.reduce((a, b) => a + b, 0) || 1;
  const limits = engine?.bounds ?? zoneLimits(hrMax ?? 190);
  return (
    <section className="panel zones">
      <CardTitle>{t('activity.zones')}</CardTitle>
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
      {!engine && hrMax && (
        <p className="note">
          {t('activity.zonesNote', {
            low: Math.round((ZONE_SHARES[0] ?? 0) * 100),
            high: Math.round((ZONE_SHARES.at(-1) ?? 0) * 100),
            hrMax,
          })}
          {estimated && ` ${t('activity.zonesEstimate', { hrMax })}`}
        </p>
      )}
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
      <CardTitle>{t('activity.best')}</CardTitle>
      <table className="num">
        <thead>
          <tr>
            <th scope="col">{t('feed.stat.distance')}</th>
            <th scope="col">{t('feed.stat.time')}</th>
            <th scope="col">{t('feed.stat.pace')}</th>
          </tr>
        </thead>
        <tbody>
          {activity.best_efforts
            .filter((e) => effortShown(e.distance_key, format.unit))
            .map((e) => (
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
      <CardTitle>{t('activity.laps')}</CardTitle>
      <div className="scroll" tabIndex={0} role="region" aria-label={t('activity.laps')}>
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
      <CardTitle>{t('activity.splits')}</CardTitle>
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

/** Save the selected section as a personal segment (OS-325). */
function SaveSegment({ activityId, section }: { activityId: number; section: [number, number] }) {
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST('/api/segments', {
        body: { activity_id: activityId, start_index: section[0], end_index: section[1], name: name.trim() },
      });
      if (!data)
        throw new Error(String((error as { detail?: unknown } | undefined)?.detail ?? t('common.error')));
      return data;
    },
    onSuccess: () => {
      setOpen(false);
      setName('');
      void queryClient.invalidateQueries({ queryKey: ['activities', 'segments'] });
    },
  });
  if (!open)
    return (
      <>
        <button type="button" className="link" onClick={() => setOpen(true)}>
          {t('segments.save')}
        </button>
        {save.isSuccess && <span className="note">{t('segments.saved')}</span>}
      </>
    );
  return (
    <form
      className="savesegment"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) save.mutate();
      }}
    >
      <input
        aria-label={t('segments.name')}
        placeholder={t('segments.name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={120}
        autoFocus
      />
      <button type="submit" className="primary" disabled={save.isPending}>
        {t('settings.save')}
      </button>
      {save.isError && <span className="note">{save.error.message}</span>}
    </form>
  );
}

/** What the engine adds (OS-312): power zones and curve, the matched route and the segments. */
function EngineExtras({ activity }: { activity: ActivityDetail }) {
  const theme = useResolvedTheme();
  const metrics = activity.metrics;
  const allTime = useQuery({
    ...curvesQuery(api, 'power', { from: '2000-01-01' }),
    enabled: Boolean(metrics?.power_curve.length),
  });
  if (!metrics && !activity.route_group && !activity.segments?.length) return null;
  const powerZones = metrics?.power_zones;
  const bounds = metrics?.power_zone_bounds;
  const curve = (metrics?.power_curve ?? []).map((c) => ({
    duration_s: c.duration_s,
    value: c.value,
    activity_id: activity.id,
    day: activity.start_utc.slice(0, 10),
  }));
  return (
    <>
      {activity.route_group && (
        <p className="note routeinfo">
          <Link to={`/routes/${activity.route_group.group}`}>
            {t('activity.routeRank', { count: activity.route_group.count, rank: activity.route_group.rank })}{' '}
            ›
          </Link>
        </p>
      )}
      {(activity.segments ?? []).length > 0 && (
        <section className="panel">
          <CardTitle>{t('activity.segmentsTitle')}</CardTitle>
          <ul className="rows">
            {(activity.segments ?? []).map((s) => (
              <li key={s.segment_id}>
                <Link to={`/segments/${s.segment_id}`}>
                  <b>{s.name}</b>
                </Link>
                <span className="num">
                  {formatDuration(s.elapsed_s)} · {s.rank === 1 ? '🏆 ' : ''}
                  {t('activity.segmentRank', {
                    rank: s.rank,
                    count: s.count,
                    best: formatDuration(s.best_s),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {curve.length > 0 && allTime.data && (
        <section className="panel">
          <CardTitle>{t('activity.powerCurve')}</CardTitle>
          <CurveChart
            period={curve}
            allTime={allTime.data}
            theme={theme}
            format={(v) => `${Math.round(v)} W`}
            colour={themes[theme].ride}
          />
        </section>
      )}
      {powerZones && bounds && (
        <section className="panel zones">
          <CardTitle>{t('activity.powerZones')}</CardTitle>
          <table className="num">
            <tbody>
              {powerZones.map((sec, i) => (
                <tr key={i}>
                  <th scope="row">Z{i + 1}</th>
                  <td className="track">
                    <i style={{ width: `${(sec / (powerZones.reduce((a, b) => a + b, 0) || 1)) * 100}%` }} />
                  </td>
                  <td className="muted">
                    {bounds[i]}
                    {i < bounds.length - 1 ? `–${(bounds[i + 1] ?? 0) - 1}` : '+'} W
                  </td>
                  <td>{formatDuration(sec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
