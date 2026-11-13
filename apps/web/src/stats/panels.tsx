import {
  eventsQuery,
  formatDuration,
  formatters,
  type EstimateOut,
  type EventOut,
  type MaterialIcon as MaterialIconName,
  type MessageKey,
  type ThemeName,
  eventShown,
} from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { api } from '../api';
import { locale, t } from '../i18n';
import { MaterialIcon } from '../MaterialIcon';
import { usePrefs } from '../prefs';
import { useResolvedTheme } from '../theme';
import { TrendChart, type Point } from './estimateCharts';
import { day, effortName, ESTIMATE_ORDER, estimateValue, methodText, RACES } from './format';

type Format = ReturnType<typeof formatters>;

/** Higher is better for these; for race times lower is; the heart rates are neither. */
const HIGHER_BETTER = new Set(['ftp', 'critical_speed', 'vdot']);
const RACE_METRES: Record<string, number> = {
  race_5k: 5000,
  race_10k: 10000,
  race_half_marathon: 21097.5,
  race_marathon: 42195,
};
const MINUS = '\u2212';
const DAY_MS = 86_400_000;

/** An estimate's history, with today's value as its last point when the history stops earlier. */
function pointsOf(e: EstimateOut): Point[] {
  const history = (e.history ?? []).map((h) => ({ day: h.day, value: h.value }));
  if (!history.length && e.day) return [{ day: e.day, value: e.value }];
  return history;
}

type Change = { text: string; tone: 'good' | 'bad' | null };

/**
 * How much an estimate moved in the last three months (or since its first value, when it is younger),
 * in its own unit, and whether that is good news: +6 W, −0:08 /km, −1:12.
 */
function changeOf(e: EstimateOut, format: Format): Change | null {
  const history = e.history ?? [];
  if (history.length < 2) return null;
  const cutoff = new Date(Date.now() - 90 * DAY_MS).toISOString().slice(0, 10);
  const older = history.filter((h) => h.day <= cutoff).at(-1);
  const before = older ?? history[0];
  if (!before) return null;
  const since = older ? null : before.day;
  let diff = e.value - before.value;
  let text: string;
  if (e.kind === 'critical_speed') {
    const metres = format.unit === 'km' ? 1000 : 1609.344;
    diff = metres / e.value - metres / before.value; // seconds per km (or mile): negative is faster
    text = `${formatDuration(Math.abs(diff))} /${format.unit}`;
  } else if (e.kind.startsWith('race_')) text = formatDuration(Math.abs(diff));
  else if (e.kind === 'vdot') text = Math.abs(diff).toFixed(1);
  else if (e.kind === 'ftp') text = `${Math.round(Math.abs(diff))} W`;
  else text = `${Math.round(Math.abs(diff))} bpm`;
  const still = e.kind === 'vdot' ? Math.abs(diff) < 0.05 : Math.abs(diff) < 0.5;
  if (still) return { text: t('estimate.unchanged'), tone: null };
  const delta = `${diff > 0 ? '+' : MINUS}${text}`;
  const better =
    e.kind === 'critical_speed' || e.kind.startsWith('race_')
      ? diff < 0
      : HIGHER_BETTER.has(e.kind)
        ? diff > 0
        : null;
  return {
    text: since ? t('estimate.since', { delta, date: day(since) }) : t('estimate.in3m', { delta }),
    tone: better === null ? null : better ? 'good' : 'bad',
  };
}

function ChangePill({ change }: { change: Change | null }) {
  if (!change) return null;
  return <span className={`delta${change.tone ? ` ${change.tone}` : ''}`}>{change.text}</span>;
}

/**
 * One estimate as a card (OS-316): its value, how much it moved in three months and how it moved, as
 * a chart. The card opens its full history, with the activities behind it.
 */
export function EstimateCard({
  estimate,
  format,
  theme,
  open,
  onOpen,
}: {
  estimate: EstimateOut;
  format: Format;
  theme: ThemeName;
  open: boolean;
  onOpen: () => void;
}) {
  const points = pointsOf(estimate);
  const name = t(`estimate.${estimate.kind}` as MessageKey);
  const show = (v: number) => estimateValue(estimate.kind, v, format);
  return (
    <button
      type="button"
      className={`panel estimate${open ? ' on' : ''}`}
      aria-expanded={open}
      aria-controls="estimate-detail"
      onClick={onOpen}
    >
      <span className="ehead">
        <span className="ename">{name}</span>
        <ChangePill change={changeOf(estimate, format)} />
      </span>
      <span className="big num">{show(estimate.value)}</span>
      {points.length > 1 && <TrendChart points={points} name={name} theme={theme} show={show} compact />}
      <span className="note">{methodText(estimate.method)}</span>
    </button>
  );
}

/** The open estimate: its whole history on axes, how it is made and the activities behind it. */
function EstimateDetail({
  estimate,
  format,
  theme,
  onClose,
}: {
  estimate: EstimateOut;
  format: Format;
  theme: ThemeName;
  onClose: () => void;
}) {
  const name = t(`estimate.${estimate.kind}` as MessageKey);
  const show = (v: number) => estimateValue(estimate.kind, v, format);
  const points = pointsOf(estimate);
  return (
    <section className="panel estimatedetail" id="estimate-detail" aria-label={name}>
      <div className="ph">
        <h2>
          {name} · <span className="num">{show(estimate.value)}</span>
        </h2>
        <ChangePill change={changeOf(estimate, format)} />
        <button type="button" className="iconbtn" aria-label={t('common.close')} onClick={onClose}>
          <MaterialIcon name="close" />
        </button>
      </div>
      {points.length > 1 ? (
        <TrendChart points={points} name={name} theme={theme} show={show} />
      ) : (
        <p className="note">{t('estimate.noHistory')}</p>
      )}
      <p className="note">
        {methodText(estimate.method)}
        {estimate.sources.length > 0 && ': '}
        {estimate.sources.map((s, i) => (
          <span key={s.id}>
            {i > 0 && ', '}
            <Link to={`/activities/${s.id}`}>{day(s.day)}</Link>
          </span>
        ))}
      </p>
    </section>
  );
}

/**
 * Race predictions (OS-913): each distance's time, its pace and how it moved in three months, and the
 * picked distance's history, faster upwards.
 */
function Predictions({ races, format, theme }: { races: EstimateOut[]; format: Format; theme: ThemeName }) {
  const [picked, setPicked] = useState<string>(
    races.find((r) => r.kind === 'race_10k')?.kind ?? races[0]?.kind ?? '',
  );
  const shown = races.find((r) => r.kind === picked) ?? races[0];
  const points = shown ? pointsOf(shown) : [];
  const name = shown ? t(`estimate.${shown.kind}` as MessageKey) : '';
  return (
    <section className="panel predictions">
      <div className="ph">
        <h2>{t('stats.predictions')}</h2>
        <span className="note">{methodText(races[0]?.method ?? '')}</span>
      </div>
      <ul className="racelist">
        {races.map((r) => {
          const metres = RACE_METRES[r.kind];
          return (
            <li key={r.kind}>
              <button
                type="button"
                className={r.kind === shown?.kind ? 'on' : undefined}
                aria-pressed={r.kind === shown?.kind}
                onClick={() => setPicked(r.kind)}
              >
                <span className="rname">{t(`estimate.${r.kind}` as MessageKey)}</span>
                <span className="rtime num">{formatDuration(r.value)}</span>
                {metres && r.value > 0 && (
                  <span className="rpace note num">{format.pace(metres / r.value)}</span>
                )}
                <ChangePill change={changeOf(r, format)} />
              </button>
            </li>
          );
        })}
      </ul>
      {shown && points.length > 1 && (
        <>
          <h3 className="charttitle">{t('estimate.raceHistory', { race: name })}</h3>
          <TrendChart
            points={points}
            name={name}
            theme={theme}
            show={(v) => formatDuration(v)}
            inverse
            times
            height={220}
          />
        </>
      )}
    </section>
  );
}

export function EstimatesPanel({ estimates }: { estimates: EstimateOut[] }) {
  const prefs = usePrefs();
  const format = useMemo(() => formatters(prefs), [prefs]);
  const theme = useResolvedTheme();
  const [open, setOpen] = useState<string | null>(null);
  const by = new Map(estimates.map((e) => [e.kind, e]));
  const main = ESTIMATE_ORDER.flatMap((k) => (by.get(k) ? [by.get(k) as EstimateOut] : []));
  const races = RACES.flatMap((k) => (by.get(k) ? [by.get(k) as EstimateOut] : []));
  const opened = open ? by.get(open) : undefined;
  if (!estimates.length) return <p className="state">{t('stats.estimatesEmpty')}</p>;
  return (
    <>
      <div className="cards estimates">
        {main.map((e) => (
          <EstimateCard
            key={e.kind}
            estimate={e}
            format={format}
            theme={theme}
            open={open === e.kind}
            onOpen={() => setOpen(open === e.kind ? null : e.kind)}
          />
        ))}
      </div>
      {opened && (
        <EstimateDetail estimate={opened} format={format} theme={theme} onClose={() => setOpen(null)} />
      )}
      {races.length > 0 && <Predictions races={races} format={format} theme={theme} />}
    </>
  );
}

/** What the engine noticed lately (OS-319). */
const EVENT_ICONS: Record<string, MaterialIconName> = {
  record: 'trophy',
  estimate_up: 'trending_up',
  ramp: 'warning',
};

/**
 * What the engine noticed lately (OS-319), the same events that send a notification: a new record, an
 * estimate going up, a risky jump in load. As the app's Notifications screen (OS-916): every one, newest
 * first, each opening its activity when it has one.
 */
export function EventsList() {
  const prefs = usePrefs();
  const format = useMemo(() => formatters(prefs), [prefs]);
  const events = useQuery(eventsQuery(api));
  if (events.isPending) return null;
  const list = (events.data ?? []).filter((e) => eventShown(e, format.unit));
  if (!list.length) return <p className="note">{t('notifications.empty')}</p>;
  return (
    <ul className="panel events">
      {list.map((e) => {
        const activity = typeof e.payload.activity_id === 'number' ? e.payload.activity_id : null;
        const body = (
          <>
            <span className={e.kind === 'ramp' ? 'eicon warn' : 'eicon'}>
              <MaterialIcon name={EVENT_ICONS[e.kind] ?? 'notifications'} />
            </span>
            <span className="etext">
              <span>{eventText(e, format)}</span>
              <small className="note">
                {new Date(e.created_at).toLocaleDateString(locale, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </small>
            </span>
            {activity && <i aria-hidden="true">›</i>}
          </>
        );
        return (
          <li key={e.id}>
            {activity ? <Link to={`/activities/${activity}`}>{body}</Link> : <div>{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

function eventText(e: EventOut, format: Format): string {
  const p = e.payload as Record<string, unknown>;
  if (e.kind === 'record')
    return t('event.record', {
      distance: effortName(String(p.distance_key)),
      time: formatDuration(Number(p.time_s)),
    });
  if (e.kind === 'estimate_up')
    return t('event.estimate_up', {
      kind: t(`estimate.${String(p.kind)}` as MessageKey),
      value: estimateValue(String(p.kind), Number(p.value), format),
    });
  if (e.kind === 'ramp') return t('event.ramp', { ramp: String(p.ramp) });
  return e.kind;
}
