import {
  BACK,
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

/** Simple outlines of each muscle group, front and back, drawn on a 100×200 figure. */
const SHAPES: Record<'front' | 'back', Partial<Record<Muscle, string[]>>> = {
  front: {
    shoulders: ['M27 44 q-8 2 -9 12 l9 2 z', 'M73 44 q8 2 9 12 l-9 2 z'],
    chest: ['M31 46 h17 v14 q-10 2 -17 -2 z', 'M52 46 h17 v12 q-7 4 -17 2 z'],
    biceps: ['M18 58 l8 1 l-1 18 l-8 -1 z', 'M82 58 l-8 1 l1 18 l8 -1 z'],
    forearms: ['M16 79 l8 1 l-2 22 l-7 -1 z', 'M84 79 l-8 1 l2 22 l7 -1 z'],
    abs: ['M42 62 h16 v30 h-16 z'],
    obliques: ['M33 64 l8 0 v26 l-7 -4 z', 'M67 64 l-8 0 v26 l7 -4 z'],
    quads: ['M33 104 h15 l-2 40 h-11 z', 'M52 104 h15 l-2 40 h-11 z'],
    calves: ['M35 150 h10 l-1 32 h-7 z', 'M55 150 h10 l-2 32 h-7 z'],
  },
  back: {
    traps: ['M38 38 h24 l6 8 h-36 z'],
    shoulders: ['M27 44 q-8 2 -9 12 l9 2 z', 'M73 44 q8 2 9 12 l-9 2 z'],
    lats: ['M31 48 h38 l-4 26 h-30 z'],
    triceps: ['M18 58 l8 1 l-1 18 l-8 -1 z', 'M82 58 l-8 1 l1 18 l8 -1 z'],
    lower_back: ['M37 76 h26 v14 h-26 z'],
    glutes: ['M33 92 h16 v14 h-16 z', 'M51 92 h16 v14 h-16 z'],
    hamstrings: ['M33 108 h15 l-2 38 h-11 z', 'M52 108 h15 l-2 38 h-11 z'],
    calves: ['M35 150 h10 l-1 32 h-7 z', 'M55 150 h10 l-2 32 h-7 z'],
  },
};

const SILHOUETTE =
  'M50 6 a10 11 0 1 1 -0.1 0 z M38 36 h24 l14 6 q8 2 9 12 l-1 26 l-2 24 l-6 -1 l1 -22 l-3 -16 l-4 20 l2 18 l-1 42 l-3 36 h-10 l-2 -36 l-3 -30 h-2 l-3 30 l-2 36 h-10 l-3 -36 l-1 -42 l2 -18 l-4 -20 l-3 16 l1 22 l-6 1 l-2 -24 l-1 -26 q1 -10 9 -12 z';

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
