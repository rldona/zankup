/**
 * Home's widgets on the web (OS-904), as the app's (OS-527): the last day with activities, only when it
 * is today or yesterday (its cards side by side), that day's steps, heart rate and HRV, the last seven
 * days by sport with the health averages, and the metrics (VO₂ max, FTP, today's steps, training load).
 * The working-out is shared with the app in `packages/core` (domain/home.ts).
 */
import {
  activitiesQuery,
  dayHeading,
  daysBefore,
  estimatesQuery,
  fitnessQuery,
  formatDuration,
  formatHoursMinutes,
  formatters,
  formLabel,
  formTone,
  FORM_GAUGE,
  type FormTone,
  weekEffort,
  weekQuery,
  healthAverage,
  healthDaysQuery,
  isoDay,
  lastDay,
  lastSevenDays,
  meQuery,
  routeThumbnail,
  SPORT_ICONS,
  SPORTS,
  type ActivitySummary,
  type MaterialIcon as MaterialIconName,
  type Sport,
} from '@zankup/core';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';

import { api } from '../api';
import { locale, t } from '../i18n';
import { MaterialIcon } from '../MaterialIcon';
import { usePrefs } from '../prefs';
import { CardTitle } from '../ui';
import { CardSkeleton, Pulse } from '../Skeleton';

type Format = ReturnType<typeof formatters>;

const STEPS_GOAL = 10_000;

const asSport = (value: string): Sport =>
  (SPORTS as readonly string[]).includes(value) ? (value as Sport) : 'other';

function useToday() {
  const [today] = useState(() => isoDay(new Date()));
  return today;
}

function useFormat() {
  const prefs = usePrefs();
  return useMemo(() => formatters(prefs), [prefs]);
}

/** The feed's first page and the last week's health days, shared by the widgets (one request each). */
function useHomeData(today: string) {
  const feed = useInfiniteQuery(activitiesQuery(api));
  // `end` is exclusive: tomorrow, so today's steps come too.
  const health = useQuery(healthDaysQuery(api, daysBefore(today, 6), daysBefore(today, -1)));
  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);
  return { feed, health, items };
}

// --- the last day -----------------------------------------------------------------------------------

export function LastDay() {
  const today = useToday();
  const format = useFormat();
  const { feed, health, items } = useHomeData(today);
  const last = lastDay(items);
  if (!feed.isFetched && !last)
    return (
      <Pulse>
        <CardSkeleton lines={2} />
      </Pulse>
    );

  // The day's activities only for today or yesterday: an older day is not news. The day's steps, heart
  // rate and HRV show either way (those of today, or yesterday's while today has none yet).
  const heading = last ? dayHeading(last.day, today) : 'date';
  const recent = last && heading !== 'date' ? last : null;
  const yesterday = daysBefore(today, 1);
  const day = recent
    ? health.data?.find((d) => d.day === recent.day)
    : (health.data?.find((d) => d.day === today && (d.steps || d.resting_hr || d.hrv)) ??
      health.data?.find((d) => d.day === yesterday));

  return (
    <section
      className="hblock"
      aria-label={recent ? t(heading === 'today' ? 'home.today' : 'home.yesterday') : undefined}
    >
      {!last && feed.isSuccess && <p className="note">{t('home.empty')}</p>}
      {recent && (
        <>
          <h2>{t(heading === 'today' ? 'home.today' : 'home.yesterday')}</h2>
          <div className="dayacts">
            {recent.activities.map((a) => (
              <DayActivity key={a.id} activity={a} format={format} />
            ))}
          </div>
        </>
      )}
      {day && (day.steps || day.resting_hr || day.hrv) ? (
        <div className="panel rowsbox">
          {day.steps ? (
            <Row
              icon="footprint"
              tint="var(--ride)"
              label={t('home.steps')}
              value={Math.round(day.steps.value).toLocaleString(locale)}
              extra={<Ring value={day.steps.value} max={STEPS_GOAL} size={34} />}
            />
          ) : null}
          {day.resting_hr ? (
            <Row
              icon="favorite"
              tint="var(--zone-5)"
              label={t('home.heartRate')}
              value={t('home.resting', { value: Math.round(day.resting_hr.value) })}
            />
          ) : null}
          {day.hrv ? (
            <Row
              icon="monitor_heart"
              tint="var(--run)"
              label={t('home.hrv')}
              value={`${Math.round(day.hrv.value)} ms`}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function DayActivity({ activity: a, format }: { activity: ActivitySummary; format: Format }) {
  const sport = asSport(a.sport);
  const route = routeThumbnail(a.route);
  const main = a.distance_m ? format.distance(a.distance_m) : formatDuration(a.moving_s ?? a.duration_s);
  const details = [
    a.distance_m ? formatDuration(a.moving_s ?? a.duration_s) : null,
    a.avg_power
      ? t('home.avgPower', { value: a.avg_power })
      : a.avg_hr
        ? t('home.avgHr', { value: a.avg_hr })
        : null,
  ].filter(Boolean);
  return (
    <Link
      to={`/activities/${a.id}`}
      className="panel dayact"
      style={{ '--sport': `var(--${sport})` } as CSSProperties}
    >
      <b className="dname">{a.name ?? t(`sport.${sport}`)}</b>
      <div className="dbody">
        <span className="dicon" aria-hidden="true">
          <MaterialIcon name={SPORT_ICONS[sport]} />
        </span>
        <span className="dfig">
          <b className="num">{main}</b>
          {details.length > 0 && <small>{details.join(' · ')}</small>}
        </span>
        {route && (
          <svg className="thumb" viewBox="0 0 88 64" aria-hidden="true">
            <polyline points={route} />
          </svg>
        )}
      </div>
    </Link>
  );
}

// --- the last seven days ------------------------------------------------------------------------------

export function LastSevenDays() {
  const today = useToday();
  const format = useFormat();
  const { health, items } = useHomeData(today);
  const sports = lastSevenDays(items, today, asSport);
  const days = health.data ?? [];
  const steps = healthAverage(days, 'steps');
  const resting = healthAverage(days, 'resting_hr');
  const hrv = healthAverage(days, 'hrv');
  const rows: { key: string; icon: MaterialIconName; tint: string; label: string; value: string }[] = [
    ...sports.map((s) => ({
      key: s.sport,
      icon: SPORT_ICONS[s.sport],
      tint: `var(--${s.sport})`,
      label: `${t(`sport.${s.sport}`)} · ${s.count}`,
      value: s.distance > 0 ? format.distance(s.distance) : formatHoursMinutes(s.moving),
    })),
    ...(steps != null
      ? [
          {
            key: 'steps',
            icon: 'footprint' as const,
            tint: 'var(--ride)',
            label: t('home.steps'),
            value: t('home.average', { value: Math.round(steps).toLocaleString(locale) }),
          },
        ]
      : []),
    ...(resting != null
      ? [
          {
            key: 'hr',
            icon: 'favorite' as const,
            tint: 'var(--zone-5)',
            label: t('home.heartRate'),
            value: t('home.resting', { value: Math.round(resting) }),
          },
        ]
      : []),
    ...(hrv != null
      ? [
          {
            key: 'hrv',
            icon: 'monitor_heart' as const,
            tint: 'var(--run)',
            label: t('home.hrv'),
            value: t('home.average', { value: `${Math.round(hrv)} ms` }),
          },
        ]
      : []),
  ];
  if (!rows.length) return null;
  return (
    <section className="hblock" aria-labelledby="last7">
      <h2 id="last7">{t('home.last7')}</h2>
      <div className="panel rowsbox">
        {rows.map((r) => (
          <Row key={r.key} icon={r.icon} tint={r.tint} label={r.label} value={r.value} />
        ))}
      </div>
    </section>
  );
}

// --- metrics ------------------------------------------------------------------------------------------

export function Metrics() {
  const today = useToday();
  const { health } = useHomeData(today);
  const estimates = useQuery(estimatesQuery(api));
  const fitness = useQuery(fitnessQuery(api, {}));
  const week = useQuery(weekQuery(api, today));
  const me = useQuery(meQuery(api));
  const effort = week.data ? weekEffort(week.data) : null;
  const vdot = estimates.data?.find((e) => e.kind === 'vdot')?.value;
  const ftp = estimates.data?.find((e) => e.kind === 'ftp')?.value;
  const now = fitness.data?.at(-1);
  const steps = health.data?.find((d) => d.day === today)?.steps?.value ?? 0;
  const weight = me.data?.weight_kg;
  return (
    <section className="hblock" aria-labelledby="metrics">
      <h2 id="metrics">{t('home.metrics')}</h2>
      <div className="tiles">
        {vdot ? (
          <Tile icon="directions_run" label={t('home.vo2')}>
            <Gauge value={vdot} min={30} max={70} label={vdot.toFixed(0)} />
            <small>{t('home.vo2Note')}</small>
          </Tile>
        ) : null}
        {ftp ? (
          <Tile icon="directions_bike" label={t('home.ftp')}>
            <Gauge value={ftp / (weight || 75)} min={1.5} max={5} label={`${Math.round(ftp)}`} unit="W" />
            {weight ? (
              <small>
                {t('home.perKg', {
                  value: (ftp / weight).toLocaleString(locale, { maximumFractionDigits: 1 }),
                })}
              </small>
            ) : null}
          </Tile>
        ) : null}
        <Tile icon="footprint" label={t('home.stepsToday')}>
          <span className="ringwrap">
            <Ring value={steps} max={STEPS_GOAL} size={110} stroke={10} />
            <b className="num">{Math.round(steps).toLocaleString(locale)}</b>
          </span>
        </Tile>
        {now ? (
          <Tile icon="speed" label={t('home.load')}>
            {/* Freshness (fitness minus fatigue) on the form's bands, as VO₂ max and FTP. */}
            <Gauge
              value={now.tsb}
              min={FORM_GAUGE.min}
              max={FORM_GAUGE.bands.at(-1)?.to ?? 30}
              label={now.tsb > 0 ? `+${now.tsb.toFixed(0)}` : now.tsb.toFixed(0)}
              bands={FORM_GAUGE.bands.map((b) => ({ colour: FORM_COLOURS[b.tone], to: b.to }))}
            />
            <span className={`formpill ${formTone(now.tsb)}`}>{t(formLabel(now.tsb))}</span>
            <small>
              {t('stats.ctl')} {now.ctl.toFixed(0)} · {t('stats.atl')} {now.atl.toFixed(0)}
            </small>
          </Tile>
        ) : null}
        {effort && week.data ? (
          // This week's moving time against an ordinary week (the previous twelve): 100 % is as usual.
          <Tile icon="timer" label={t('stats.load')} stretch>
            <p className="big num">
              {effort.share == null ? formatHoursMinutes(week.data.this_week.moving_s) : `${effort.share} %`}
            </p>
            <div className="meterbar" aria-hidden="true">
              <i style={{ width: `${Math.min(100, (effort.share ?? 0) / 1.5)}%` }} />
              <b style={{ left: `${100 / 1.5}%` }} />
            </div>
            <small>{t('stats.loadNote', { average: formatHoursMinutes(effort.average) })}</small>
          </Tile>
        ) : null}
      </div>
    </section>
  );
}

// --- pieces -------------------------------------------------------------------------------------------

function Row({
  icon,
  tint,
  label,
  value,
  extra,
}: {
  icon: MaterialIconName;
  tint: string;
  label: string;
  value: string;
  extra?: ReactNode;
}) {
  return (
    <div className="hrow">
      <span style={{ color: tint }}>
        <MaterialIcon name={icon} />
      </span>
      <span className="hlabel">{label}</span>
      <span className="num">{value}</span>
      {extra}
    </div>
  );
}

function Tile({
  icon,
  label,
  children,
  stretch = false,
}: {
  icon: MaterialIconName;
  label: string;
  children: ReactNode;
  /** Bars across the tile instead of one centred figure (the training load, this week's effort). */
  stretch?: boolean;
}) {
  return (
    <article className="panel tile">
      <CardTitle>
        <MaterialIcon name={icon} />
        {label}
      </CardTitle>
      <div className={stretch ? 'tbody stretch' : 'tbody'}>{children}</div>
    </article>
  );
}

/** An arc from `from` to `to` degrees (0 is up, clockwise) as SVG path data. */
function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const point = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return `${(cx + r * Math.cos(rad)).toFixed(2)} ${(cy + r * Math.sin(rad)).toFixed(2)}`;
  };
  const large = to - from > 180 ? 1 : 0;
  return `M ${point(from)} A ${r} ${r} 0 ${large} 1 ${point(to)}`;
}

/** Progress as a ring (steps against the day's goal). */
function Ring({
  value,
  max,
  size,
  stroke = 4,
}: {
  value: number;
  max: number;
  size: number;
  stroke?: number;
}) {
  const share = Math.max(0, Math.min(1, value / max));
  const r = (size - stroke) / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="hring">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
      {share > 0 && (
        <path
          d={arc(size / 2, size / 2, r, 0, Math.max(1, share * 359.99))}
          fill="none"
          stroke="var(--ride)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

const GAUGE = ['#e03131', '#e8590c', '#2f9e44', '#1c7ed6', '#7950f2'];

/** The form's colours, as its pill: rested blue, neither grey, building green, overreaching red. */
const FORM_COLOURS: Record<FormTone, string> = {
  fresh: 'var(--ride)',
  neutral: 'var(--muted)',
  optimal: 'var(--form-positive)',
  overreaching: 'var(--form-negative)',
};

/**
 * A 270° gauge in coloured bands, with a dot at the value and the figure in the middle: five equal
 * bands by default (VO₂ max, FTP), or `bands` with each one's upper end (the training load's form).
 */
function Gauge({
  value,
  min,
  max,
  label,
  unit,
  bands: given,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  unit?: string;
  bands?: { colour: string; to: number }[];
}) {
  const size = 120;
  const r = 48;
  const start = -135;
  const sweep = 270;
  const gap = 4;
  const scale =
    given ?? GAUGE.map((colour, i) => ({ colour, to: min + ((max - min) * (i + 1)) / GAUGE.length }));
  const at = (v: number) => Math.max(0, Math.min(1, (v - min) / (max - min)));
  const share = at(value);
  const angle = ((start + sweep * share - 90) * Math.PI) / 180;
  const dotColour = (scale.find((b) => value <= b.to) ?? scale.at(-1))?.colour ?? 'var(--fg)';
  return (
    <span className="gauge">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {scale.map(({ colour, to }, i) => {
          const from = start + sweep * at(i ? (scale[i - 1]?.to ?? min) : min) + (i ? gap / 2 : 0);
          const end = start + sweep * at(to) - (i < scale.length - 1 ? gap / 2 : 0);
          return (
            <path
              key={i}
              d={arc(size / 2, size / 2, r, from, end)}
              fill="none"
              stroke={colour}
              strokeWidth={8}
              strokeLinecap="round"
            />
          );
        })}
        <circle
          cx={size / 2 + r * Math.cos(angle)}
          cy={size / 2 + r * Math.sin(angle)}
          r={8}
          fill={dotColour}
        />
      </svg>
      <span className="gvalue">
        <b className="num">{label}</b>
        {unit ? <small>{unit}</small> : null}
      </span>
    </span>
  );
}
