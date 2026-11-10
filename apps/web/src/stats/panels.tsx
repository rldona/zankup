import {
  eventsQuery,
  formatDuration,
  formatters,
  type EstimateOut,
  type EventOut,
  type MessageKey,
} from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link } from 'react-router';

import { api } from '../api';
import { Sparkline } from '../charts/static';
import { t } from '../i18n';
import { usePrefs } from '../prefs';
import { day, effortName, ESTIMATE_ORDER, estimateValue, methodText, RACES } from './format';

type Format = ReturnType<typeof formatters>;

/** One estimate with where it comes from: method, source activities and its trend (OS-316). */
export function EstimateCard({ estimate, format }: { estimate: EstimateOut; format: Format }) {
  const history = estimate.history.map((h) => h.value);
  return (
    <article className="panel estimate">
      <h3>{t(`estimate.${estimate.kind}` as MessageKey)}</h3>
      <p className="big num">{estimateValue(estimate.kind, estimate.value, format)}</p>
      {history.length > 1 && <Sparkline values={history} label={t('stats.estimates')} />}
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
    </article>
  );
}

export function EstimatesPanel({ estimates }: { estimates: EstimateOut[] }) {
  const prefs = usePrefs();
  const format = useMemo(() => formatters(prefs), [prefs]);
  const by = new Map(estimates.map((e) => [e.kind, e]));
  const main = ESTIMATE_ORDER.flatMap((k) => (by.get(k) ? [by.get(k) as EstimateOut] : []));
  const races = RACES.flatMap((k) => (by.get(k) ? [by.get(k) as EstimateOut] : []));
  if (!estimates.length) return <p className="state">{t('stats.estimatesEmpty')}</p>;
  return (
    <>
      <div className="cards">
        {main.map((e) => (
          <EstimateCard key={e.kind} estimate={e} format={format} />
        ))}
      </div>
      {races.length > 0 && (
        <section className="panel">
          <div className="ph">
            <h2>{t('stats.predictions')}</h2>
            <span className="note">{methodText(races[0]?.method ?? '')}</span>
          </div>
          <dl className="kpis num">
            {races.map((r) => (
              <div key={r.kind} className="kpi">
                <dd>{formatDuration(r.value)}</dd>
                <dt>{t(`estimate.${r.kind}` as MessageKey)}</dt>
              </div>
            ))}
          </dl>
        </section>
      )}
    </>
  );
}

/** What the engine noticed lately (OS-319). */
export function EventsList() {
  const prefs = usePrefs();
  const format = useMemo(() => formatters(prefs), [prefs]);
  const events = useQuery(eventsQuery(api));
  if (!events.data?.length) return null;
  return (
    <section className="panel">
      <div className="ph">
        <h2>{t('stats.events')}</h2>
      </div>
      <ul className="rows">
        {events.data.slice(0, 6).map((e) => (
          <li key={e.id}>
            <span>{eventText(e, format)}</span>
            {typeof e.payload.activity_id === 'number' && (
              <Link to={`/activities/${e.payload.activity_id}`}>›</Link>
            )}
          </li>
        ))}
      </ul>
    </section>
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
