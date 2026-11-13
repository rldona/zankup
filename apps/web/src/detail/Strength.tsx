import {
  formatDuration,
  groupSets,
  musclesWorked,
  strengthFlow,
  strengthTotals,
  type MessageKey,
  type StrengthSet,
} from '@zankup/core';
import type { CSSProperties } from 'react';

import { locale, t } from '../i18n';
import { BodyMap } from './BodyMap';

/** Each exercise in its own shade of the strength colour (itself, lighter, darker, lightest), so the
 * flow bar and its block match. */
const SHADES = [
  'var(--strength)',
  'color-mix(in srgb, var(--strength) 55%, var(--fg))',
  'color-mix(in srgb, var(--strength) 55%, var(--surface-2))',
  'color-mix(in srgb, var(--strength) 25%, var(--fg))',
];
const exerciseColour = (group: number) => SHADES[group % SHADES.length];

/**
 * A strength workout (OS-225): the totals in large figures, the session's flow (each set in its
 * exercise's colour, the rests between them), then each exercise with its sets: reps drawn as a bar,
 * weight, time and the rest after each. Then a front/back body map with the muscles worked (left out
 * with `cover`, when the body map is already the detail's cover).
 */
export function Strength({ sets, cover = false }: { sets: StrengthSet[]; cover?: boolean }) {
  const groups = groupSets(sets);
  if (!groups.length) return null;
  const totals = strengthTotals(sets);
  const flow = strengthFlow(sets);
  const worked = musclesWorked(sets);
  const most = Math.max(1, ...groups.flatMap((g) => g.sets.map((s) => s.reps ?? 0)));
  const exercise = (category: string | null) => t(`exercise.${category ?? 'unknown'}` as MessageKey);
  const kg = (value: number) => `${Math.round(value).toLocaleString(locale)} kg`;
  const figures: [string, string][] = [
    [t('strength.sets'), String(totals.sets)],
    [t('strength.reps'), String(totals.reps)],
    ...(totals.volume_kg > 0 ? ([[t('strength.volume'), kg(totals.volume_kg)]] as [string, string][]) : []),
    [t('strength.work'), formatDuration(totals.work_s)],
    ...(totals.rest_s > 0
      ? ([[t('strength.rest'), formatDuration(totals.rest_s)]] as [string, string][])
      : []),
  ];

  return (
    <>
      <section className="panel strength">
        <div className="ph">
          <h2>{t('strength.sets')}</h2>
          <span className="note num">
            {t('strength.summary', {
              sets: totals.sets,
              reps: totals.reps,
              volume: Math.round(totals.volume_kg).toLocaleString(locale),
            })}
          </span>
        </div>
        <dl className="sfigures num">
          {figures.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {flow.length > 1 && (
          <figure className="sflow">
            <div className="sflowbar" aria-hidden="true">
              {flow.map((segment, i) => (
                <span
                  key={i}
                  className={segment.kind}
                  style={{
                    flexGrow: segment.share,
                    ...(segment.group != null ? { background: exerciseColour(segment.group) } : {}),
                  }}
                />
              ))}
            </div>
            <figcaption className="note">
              {t('strength.flow')} · {formatDuration(totals.work_s + totals.rest_s)}
            </figcaption>
          </figure>
        )}
        <div className="exercises">
          {groups.map((group, g) => (
            <div key={g} className="exercise" style={{ '--ex': exerciseColour(g) } as CSSProperties}>
              <div className="exhead">
                <span className="exdot" aria-hidden="true" />
                <h3>{exercise(group.category)}</h3>
                <span className="note num">
                  {t('strength.exerciseSummary', { sets: group.sets.length, reps: group.reps })}
                  {group.volume_kg > 0 ? ` · ${kg(group.volume_kg)}` : ''}
                </span>
              </div>
              <table className="num">
                <thead>
                  <tr>
                    <th scope="col">{t('strength.set')}</th>
                    <th scope="col">{t('strength.reps')}</th>
                    <th scope="col">{t('strength.weight')}</th>
                    <th scope="col">{t('strength.time')}</th>
                    <th scope="col">{t('strength.rest')}</th>
                  </tr>
                </thead>
                <tbody>
                  {group.sets.map((set, i) => (
                    <tr key={i}>
                      <td>
                        <span className="setno">{i + 1}</span>
                      </td>
                      <td className="repcell">
                        <span
                          className="repbar"
                          aria-hidden="true"
                          style={{ width: `${Math.max(6, ((set.reps ?? 0) / most) * 100)}%` }}
                        />
                        <b>{set.reps ?? '—'}</b>
                      </td>
                      <td>
                        {set.weight_kg
                          ? `${set.weight_kg.toLocaleString(locale)} kg`
                          : t('strength.bodyweight')}
                      </td>
                      <td>{formatDuration(set.duration_s)}</td>
                      <td className="restcell">{set.rest_s != null ? formatDuration(set.rest_s) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </section>
      {!cover && worked.size > 0 && (
        <section className="panel">
          <div className="ph">
            <h2>{t('strength.muscles')}</h2>
          </div>
          <BodyMap worked={worked} />
          <p className="note">{[...worked.keys()].map((m) => t(`muscle.${m}`)).join(' · ')}</p>
        </section>
      )}
    </>
  );
}
