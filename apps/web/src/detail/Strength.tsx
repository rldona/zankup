import {
  BACK,
  BODY_SHAPES as SHAPES,
  BODY_SILHOUETTE as SILHOUETTE,
  FRONT,
  formatDuration,
  groupSets,
  musclesWorked,
  type MessageKey,
  type Muscle,
  type StrengthSet,
} from '@zankup/core';

import { locale, t } from '../i18n';

/**
 * A strength workout (OS-225): sets grouped by exercise with reps, weight, time and the rest after
 * each, the total volume (reps × weight), and a front/back body map with the muscles worked.
 */
export function Strength({ sets }: { sets: StrengthSet[] }) {
  const groups = groupSets(sets);
  if (!groups.length) return null;
  const active = groups.reduce((n, g) => n + g.sets.length, 0);
  const reps = groups.reduce((n, g) => n + g.reps, 0);
  const volume = groups.reduce((n, g) => n + g.volume_kg, 0);
  const worked = musclesWorked(sets);
  const exercise = (category: string | null) => t(`exercise.${category ?? 'unknown'}` as MessageKey);

  return (
    <>
      <section className="panel">
        <div className="ph">
          <h2>{t('strength.sets')}</h2>
          <span className="note num">
            {t('strength.summary', { sets: active, reps, volume: Math.round(volume).toLocaleString(locale) })}
          </span>
        </div>
        {groups.map((group, g) => (
          <div key={g} className="exercise">
            <h3>{exercise(group.category)}</h3>
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
                    <td>{i + 1}</td>
                    <td>{set.reps ?? '—'}</td>
                    <td>
                      {set.weight_kg
                        ? `${set.weight_kg.toLocaleString(locale)} kg`
                        : t('strength.bodyweight')}
                    </td>
                    <td>{formatDuration(set.duration_s)}</td>
                    <td>{set.rest_s != null ? formatDuration(set.rest_s) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>
      <section className="panel">
        <div className="ph">
          <h2>{t('strength.muscles')}</h2>
        </div>
        <BodyMap worked={worked} />
        {worked.size === 0 ? (
          <p className="note">{t('strength.noMuscles')}</p>
        ) : (
          <p className="note">{[...worked.keys()].map((m) => t(`muscle.${m}`)).join(' · ')}</p>
        )}
      </section>
    </>
  );
}

function BodyMap({ worked }: { worked: Map<Muscle, number> }) {
  const most = Math.max(1, ...worked.values());
  return (
    <div className="bodymap">
      {(['front', 'back'] as const).map((side) => (
        <figure key={side}>
          <svg
            viewBox="0 0 100 200"
            role="img"
            aria-label={`${t(side === 'front' ? 'strength.front' : 'strength.back')}: ${
              (side === 'front' ? FRONT : BACK)
                .filter((m) => worked.has(m))
                .map((m) => t(`muscle.${m}`))
                .join(', ') || '—'
            }`}
          >
            <path d={SILHOUETTE} className="body" />
            {Object.entries(SHAPES[side]).map(([muscle, paths]) =>
              paths.map((d, i) => {
                const sets = worked.get(muscle as Muscle) ?? 0;
                return (
                  <path
                    key={`${muscle}-${i}`}
                    d={d}
                    className={sets ? 'muscle on' : 'muscle'}
                    style={sets ? { opacity: 0.45 + 0.55 * (sets / most) } : undefined}
                  />
                );
              }),
            )}
          </svg>
          <figcaption className="note">{t(side === 'front' ? 'strength.front' : 'strength.back')}</figcaption>
        </figure>
      ))}
    </div>
  );
}
