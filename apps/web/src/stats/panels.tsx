import {
  eventsQuery,
  formatDuration,
  formatHoursMinutes,
  formatters,
  goalsQuery,
  SPORTS,
  type EstimateOut,
  type EventOut,
  type GoalOut,
  type MessageKey,
} from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';

import { api } from '../api';
import { Sparkline } from '../charts/static';
import { locale, t } from '../i18n';
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

function goalValue(goal: { metric: string }, value: number, format: Format): string {
  if (goal.metric === 'distance') return format.distance(value);
  if (goal.metric === 'time') return formatHoursMinutes(value);
  return value.toLocaleString(locale, { maximumFractionDigits: 1 });
}

/** Goals with their progress ring and end-of-period projection (OS-318). */
export function GoalsPanel({ editable = false }: { editable?: boolean }) {
  const prefs = usePrefs();
  const format = useMemo(() => formatters(prefs), [prefs]);
  const goals = useQuery(goalsQuery(api));
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: goalsQuery(api).queryKey });
  const remove = useMutation({
    mutationFn: async (id: number) => {
      await api.DELETE('/api/goals/{goal_id}', { params: { path: { goal_id: id } } });
    },
    onSuccess: () => void refresh(),
  });
  if (!goals.data) return null;
  return (
    <>
      {goals.data.length === 0 && !editable && null}
      {goals.data.length === 0 && editable && <p className="note">{t('goals.empty')}</p>}
      <div className="cards">
        {goals.data.map((g) => (
          <GoalCard
            key={g.id}
            goal={g}
            format={format}
            onDelete={editable ? () => remove.mutate(g.id) : undefined}
          />
        ))}
      </div>
      {editable && <GoalForm onDone={() => void refresh()} unit={format.unit} />}
    </>
  );
}

function GoalCard({ goal, format, onDelete }: { goal: GoalOut; format: Format; onDelete?: () => void }) {
  const share = Math.min(1, goal.current / goal.target);
  const done = goal.current >= goal.target;
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <article className="panel goal">
      <svg viewBox="0 0 74 74" className="ring" role="img" aria-label={`${Math.round(share * 100)} %`}>
        <circle cx="37" cy="37" r={r} className="track" />
        <circle
          cx="37"
          cy="37"
          r={r}
          className="fill"
          strokeDasharray={`${c * share} ${c}`}
          transform="rotate(-90 37 37)"
        />
        <text x="37" y="42" textAnchor="middle">
          {Math.round(share * 100)}%
        </text>
      </svg>
      <div>
        <h3>
          {t(`goals.period.${goal.period}` as MessageKey)} ·{' '}
          {goal.sport ? t(`sport.${goal.sport as (typeof SPORTS)[number]}`) : t('goals.allSports')}
        </h3>
        <p className="num">
          <b>{goalValue(goal, goal.current, format)}</b> / {goalValue(goal, goal.target, format)}
        </p>
        <p className="note">
          {done
            ? t('goals.done')
            : t(goal.projection >= goal.target ? 'goals.onTrack' : 'goals.behind', {
                projection: goalValue(goal, goal.projection, format),
              })}
        </p>
        {onDelete && (
          <button type="button" className="link" onClick={onDelete}>
            {t('goals.delete')}
          </button>
        )}
      </div>
    </article>
  );
}

function GoalForm({ onDone, unit }: { onDone: () => void; unit: string }) {
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('week');
  const [metric, setMetric] = useState<'distance' | 'time' | 'count'>('distance');
  const [sport, setSport] = useState('');
  const [target, setTarget] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      const n = Number(target);
      const value =
        metric === 'distance' ? n * (unit === 'km' ? 1000 : 1609.344) : metric === 'time' ? n * 3600 : n;
      await api.POST('/api/goals', { body: { period, metric, sport: sport || null, target: value } });
    },
    onSuccess: () => {
      setTarget('');
      onDone();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (Number(target) > 0) save.mutate();
  };
  return (
    <form className="fields goalform" onSubmit={submit}>
      <label className="field">
        <b>{t('stats.period')}</b>
        <select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
          {(['week', 'month', 'year'] as const).map((p) => (
            <option key={p} value={p}>
              {t(`goals.period.${p}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <b>{t('goals.measure')}</b>
        <select value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)}>
          {(['distance', 'time', 'count'] as const).map((m) => (
            <option key={m} value={m}>
              {t(`goals.metric.${m}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <b>{t('feed.sports')}</b>
        <select value={sport} onChange={(e) => setSport(e.target.value)}>
          <option value="">{t('goals.allSports')}</option>
          {SPORTS.filter((s) => s !== 'other').map((s) => (
            <option key={s} value={s}>
              {t(`sport.${s}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <b>
          {t('goals.target')} ({metric === 'distance' ? unit : metric === 'time' ? 'h' : '#'})
        </b>
        <input
          type="number"
          min={1}
          inputMode="decimal"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          required
        />
      </label>
      <div className="actions">
        <button type="submit" className="primary" disabled={save.isPending}>
          {t('goals.add')}
        </button>
      </div>
    </form>
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
