import {
  calendarQuery,
  formatHoursMinutes,
  formatters,
  goalInput,
  goalPoints,
  goalsQuery,
  goalTarget,
  SPORTS,
  type GoalOut,
  type MessageKey,
} from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { api } from '../api';
import { Modal } from '../detail/Tools';
import { locale, t } from '../i18n';
import { MaterialIcon } from '../MaterialIcon';
import { usePrefs } from '../prefs';
import { CardSkeleton, Pulse } from '../Skeleton';

type Format = ReturnType<typeof formatters>;
type Metric = 'distance' | 'time' | 'count';
type Period = 'week' | 'month' | 'year';

function goalValue(goal: { metric: string }, value: number, format: Format): string {
  if (goal.metric === 'distance') return format.distance(value);
  if (goal.metric === 'time') return formatHoursMinutes(value);
  return value.toLocaleString(locale, { maximumFractionDigits: 1 });
}

const goalName = (goal: GoalOut) =>
  `${t(`goals.period.${goal.period}` as MessageKey)} · ${
    goal.sport ? t(`sport.${goal.sport as (typeof SPORTS)[number]}`) : t('goals.allSports')
  }`;

/**
 * Goals as their own section (OS-903, OS-911), as the app's Goals tab: each goal with its progress and
 * end-of-period projection; clicking a card opens and closes its evolution day by day. The pencil turns
 * on editing (each goal can be changed or deleted) and the + adds one.
 */
export function Goals() {
  const prefs = usePrefs();
  const format = useMemo(() => formatters(prefs), [prefs]);
  const goals = useQuery(goalsQuery(api));
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<GoalOut | 'new' | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: goalsQuery(api).queryKey });
  const remove = useMutation({
    mutationFn: async (id: number) => {
      await api.DELETE('/api/goals/{goal_id}', { params: { path: { goal_id: id } } });
    },
    onSuccess: refresh,
  });
  return (
    <section className="page goals">
      <div className="titlebar">
        <h1>{t('nav.goals')}</h1>
        <button
          type="button"
          className="iconbtn"
          aria-label={editing ? t('goals.doneEditing') : t('goals.edit')}
          aria-pressed={editing}
          title={editing ? t('goals.doneEditing') : t('goals.edit')}
          onClick={() => setEditing(!editing)}
        >
          <MaterialIcon name={editing ? 'check' : 'edit_square'} />
        </button>
        <button
          type="button"
          className="iconbtn"
          aria-label={t('goals.add')}
          title={t('goals.add')}
          onClick={() => setForm('new')}
        >
          <MaterialIcon name="add" />
        </button>
      </div>
      {!goals.data && (
        <Pulse>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </Pulse>
      )}
      {goals.data?.length === 0 && <p className="note">{t('goals.empty')}</p>}
      <div className="goalgrid">
        {goals.data?.map((g) => (
          <GoalCard key={g.id} goal={g} format={format}>
            {editing && (
              <div className="actions">
                <button type="button" onClick={() => setForm(g)}>
                  <MaterialIcon name="edit_square" />
                  {t('goals.edit')}
                </button>
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={() =>
                    window.confirm(`${t('goals.delete')}: ${goalName(g)}?`) && remove.mutate(g.id)
                  }
                >
                  <MaterialIcon name="delete" />
                  {t('goals.delete')}
                </button>
              </div>
            )}
          </GoalCard>
        ))}
      </div>
      {form && (
        <GoalForm
          goal={form === 'new' ? undefined : form}
          unit={format.unit}
          onClose={() => setForm(null)}
          onDone={() => {
            refresh();
            setForm(null);
          }}
        />
      )}
    </section>
  );
}

function GoalCard({ goal, format, children }: { goal: GoalOut; format: Format; children?: React.ReactNode }) {
  const share = Math.min(1, goal.current / goal.target);
  const done = goal.current >= goal.target;
  const [chart, setChart] = useState(false);
  return (
    <article className="panel goalcard">
      {/* The whole card opens and closes the day-by-day chart; the chart sits outside the button, so
          reading it never folds it. */}
      <button type="button" className="goalhead" aria-expanded={chart} onClick={() => setChart(!chart)}>
        <span className="goalrow">
          <b>{goalName(goal)}</b>
          <b className="num">{Math.round(share * 100)} %</b>
        </span>
        <span className="goalbar" aria-hidden="true">
          <i style={{ width: `${share * 100}%` }} />
        </span>
        <span className="num">
          <b>{goalValue(goal, goal.current, format)}</b> / {goalValue(goal, goal.target, format)}
        </span>
        {/* Nothing done yet: no projection to speak of. */}
        {(done || goal.current > 0) && (
          <small className="note">
            {done
              ? t('goals.done')
              : t(goal.projection >= goal.target ? 'goals.onTrack' : 'goals.behind', {
                  projection: goalValue(goal, goal.projection, format),
                })}
          </small>
        )}
        <span className="goaltoggle">
          {t(chart ? 'goals.hideChart' : 'goals.showChart')}
          <MaterialIcon name={chart ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} />
        </span>
      </button>
      {chart && <GoalChart goal={goal} format={format} />}
      {children}
    </article>
  );
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * A goal day by day, as the app's chart: what each day (or month) added, over a soft fill, with the
 * day's share of the target dashed; green points where something was done, grey rings where not, and
 * the days to come without a point. Hovering or clicking picks a day; above, its amount and the total.
 */
function GoalChart({ goal, format }: { goal: GoalOut; format: Format }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const [today] = useState(() => iso(new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)));
  const [picked, setPicked] = useState<number | null>(null);
  const calendar = useQuery(calendarQuery(api, { from: goal.start, to: goal.end }));
  const points = calendar.data ? goalPoints(goal, calendar.data, today, locale) : [];
  const past = points.filter((p) => p.state !== 'future').length;
  const current = Math.min(picked ?? past - 1, past - 1);
  const at = current >= 0 ? points[current] : null;

  const height = 130;
  const top = 10;
  const bottom = height - 14;
  const axis = 56;
  const plot = Math.max(0, width - axis);
  const share = points.length ? goal.target / points.length : goal.target;
  const floor = goal.metric === 'count' ? 2 : 0;
  const hi = niceTop(Math.max(floor, share, ...points.map((p) => p.own)) || 1);
  const ticks = [0, hi / 2, hi];
  const slot = points.length ? plot / points.length : 0;
  const x = (i: number) => slot * i + slot / 2;
  const y = (v: number) => bottom - (bottom - top) * (v / hi);
  const radius = Math.max(2.5, Math.min(4.5, slot * 0.16));
  const labelEvery = points.length > 12 ? 5 : 1;
  const shown = points.slice(0, past);
  const line = shown.length ? `M0 ${y(0)}${shown.map((p, i) => `L${x(i)} ${y(p.own)}`).join('')}` : '';
  const area = shown.some((p) => p.own > 0) ? `${line}L${x(shown.length - 1)} ${bottom}L0 ${bottom}Z` : '';
  const tick = (v: number) =>
    goal.metric === 'distance'
      ? `${Math.round(v / (format.unit === 'km' ? 1000 : 1609.344))} ${format.unit}`
      : goal.metric === 'time'
        ? `${Math.round(v / 3600)} h`
        : String(Math.round(v));
  const pick = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || !slot || !past) return;
    setPicked(Math.max(0, Math.min(past - 1, Math.floor((clientX - rect.left) / slot))));
  };

  return (
    <div className="goalchart">
      <p className="note goalat">
        {at ? (
          <>
            {at.when} · <b className="num">{goalValue(goal, at.own, format)}</b>
            {current > 0 ? ` · ${t('goals.total', { value: goalValue(goal, at.done, format) })}` : ''}
          </>
        ) : (
          ' '
        )}
      </p>
      <div
        ref={box}
        className="goalplot"
        onMouseMove={(e) => pick(e.clientX)}
        onClick={(e) => pick(e.clientX)}
        role="img"
        aria-label={t('goals.showChart')}
      >
        {width > 0 && calendar.data && (
          <svg width={width} height={height} aria-hidden="true">
            <line x1={0} x2={plot} y1={y(0)} y2={y(0)} className="gfloor" />
            <line x1={0} x2={plot} y1={y(hi)} y2={y(hi)} className="gfaint" />
            {points.map((_, i) => (
              <line key={i} x1={x(i)} x2={x(i)} y1={y(hi)} y2={y(0)} className="gfaint" />
            ))}
            <line x1={0} x2={plot} y1={y(share)} y2={y(share)} className="gshare" />
            {area && <path d={area} className="garea" />}
            {line && <path d={line} className="gline" />}
            {at && <line x1={x(current)} x2={x(current)} y1={top} y2={bottom} className="gcursor" />}
            {shown.map((p, i) => (
              <circle
                key={i}
                cx={x(i)}
                cy={y(p.own)}
                r={i === current ? radius + 1.5 : radius}
                className={`${p.own > 0 ? 'gon' : 'goff'}${i === current ? ' gpicked' : ''}`}
              />
            ))}
            {ticks.map((v) => (
              <text key={v} x={plot + 8} y={y(v) + 4} className="gtick">
                {tick(v)}
              </text>
            ))}
          </svg>
        )}
      </div>
      <div className="goaldays" style={{ width: plot }}>
        {points.map((p, i) => (
          <span key={i} className={i === current ? 'on' : undefined}>
            {i % labelEvery === 0 || i === points.length - 1 ? p.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A round top for the axis, so its marks read cleanly. */
function niceTop(v: number): number {
  const power = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((m) => m * power >= v) ?? 10) * power;
}

/**
 * Adding a goal, or changing one, in a dialog (OS-911): each label with its options under it, with room
 * between the blocks, as the app's form. Strength has no distance, so it measures time or sessions.
 */
function GoalForm({
  goal,
  unit,
  onClose,
  onDone,
}: {
  goal?: GoalOut;
  unit: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [period, setPeriod] = useState<Period>((goal?.period as Period | undefined) ?? 'week');
  const [metric, setMetric] = useState<Metric>((goal?.metric as Metric | undefined) ?? 'distance');
  const [sport, setSport] = useState(goal?.sport ?? '');
  const [target, setTarget] = useState(
    goal ? String(Math.round(goalInput(goal.metric as Metric, goal.target, unit) * 100) / 100) : '',
  );
  const value = Number(target.replace(',', '.'));
  const metrics: Metric[] = sport === 'strength' ? ['time', 'count'] : ['distance', 'time', 'count'];
  const save = useMutation({
    mutationFn: async () => {
      const body = { period, metric, sport: sport || null, target: goalTarget(metric, value, unit) };
      const { error } = goal
        ? await api.PATCH('/api/goals/{goal_id}', { params: { path: { goal_id: goal.id } }, body })
        : await api.POST('/api/goals', { body });
      if (error) throw new Error('goal');
    },
    onSuccess: onDone,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value > 0) save.mutate();
  };
  const choices = <T extends string>(
    label: string,
    current: T,
    options: { value: T; label: string }[],
    onChange: (v: T) => void,
  ) => (
    <div className="field">
      <b>{label}</b>
      <div className="chips" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className="chip"
            role="radio"
            aria-checked={o.value === current}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <Modal title={goal ? t('goals.editTitle') : t('goals.add')} onClose={onClose}>
      <form className="stack goalform" onSubmit={submit}>
        {choices(
          t('stats.period'),
          period,
          (['week', 'month', 'year'] as const).map((p) => ({ value: p, label: t(`goals.period.${p}`) })),
          setPeriod,
        )}
        {choices(
          t('feed.sports'),
          sport,
          [
            { value: '', label: t('goals.allSports') },
            ...SPORTS.filter((s) => s !== 'other').map((s) => ({
              value: s as string,
              label: t(`sport.${s}`),
            })),
          ],
          (next) => {
            setSport(next);
            if (next === 'strength' && metric === 'distance') setMetric('time');
          },
        )}
        {choices(
          t('goals.measure'),
          metric,
          metrics.map((m) => ({ value: m, label: t(`goals.metric.${m}`) })),
          setMetric,
        )}
        <label className="field">
          <b>
            {t('goals.target')} ({metric === 'distance' ? unit : metric === 'time' ? 'h' : '#'})
          </b>
          <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} required />
        </label>
        {save.isError && (
          <p className="note" role="alert">
            {t('common.error')}
          </p>
        )}
        <div className="actions">
          <button type="submit" className="primary" disabled={!(value > 0) || save.isPending}>
            {goal ? t('settings.save') : t('goals.add')}
          </button>
          <button type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
