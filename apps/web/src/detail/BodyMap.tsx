import {
  BACK,
  BODY_DETAIL as DETAIL,
  BODY_SHAPES as SHAPES,
  BODY_SILHOUETTE as SILHOUETTE,
  FRONT,
  type Muscle,
} from '@zankup/core';

import { t } from '../i18n';

const label = (side: 'front' | 'back', worked: Map<Muscle, number>) =>
  `${t(side === 'front' ? 'strength.front' : 'strength.back')}: ${
    (side === 'front' ? FRONT : BACK)
      .filter((m) => worked.has(m))
      .map((m) => t(`muscle.${m}`))
      .join(', ') || '—'
  }`;

/** The glow of a worked muscle: brighter in its middle (each shape's own box, objectBoundingBox). */
const Glow = () => (
  <defs>
    <radialGradient id="muscle-glow">
      <stop offset="0" className="glow-core" />
      <stop offset="1" className="glow-edge" />
    </radialGradient>
  </defs>
);

/** One side of the figure, its muscles shaded by how many sets worked them. */
function Side({ side, worked, x = 0 }: { side: 'front' | 'back'; worked: Map<Muscle, number>; x?: number }) {
  const most = Math.max(1, ...worked.values());
  return (
    <g transform={x ? `translate(${x} 0)` : undefined}>
      <path d={SILHOUETTE} className="body" />
      {DETAIL[side].map((d) => (
        <path key={d} d={d} className="muscle" />
      ))}
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
    </g>
  );
}

/** The front and back figures with the muscles worked: in the strength panel, or as the cover. */
export function BodyMap({ worked }: { worked: Map<Muscle, number> }) {
  return (
    <div className="bodymap">
      {(['front', 'back'] as const).map((side) => (
        <figure key={side}>
          <svg viewBox="0 0 100 200" role="img" aria-label={label(side, worked)}>
            <Glow />
            <Side side={side} worked={worked} />
          </svg>
          <figcaption className="note">{t(side === 'front' ? 'strength.front' : 'strength.back')}</figcaption>
        </figure>
      ))}
    </div>
  );
}

/**
 * A strength workout's cover (as the map is a route's): the body map across the top of the detail,
 * with the muscles worked named under it.
 */
export function MuscleCover({ worked }: { worked: Map<Muscle, number> }) {
  return (
    <section className="mapblock musclecover" aria-label={t('strength.muscles')}>
      <BodyMap worked={worked} />
      <p className="coverlegend">
        <span className="swatch" aria-hidden="true" />
        {[...worked.keys()].map((m) => t(`muscle.${m}`)).join(' · ')}
      </p>
    </section>
  );
}

/** Both sides small, on a feed card's tile in place of a route. */
export function BodyThumb({ worked }: { worked: Map<Muscle, number> }) {
  return (
    <svg className="thumb bodythumb" viewBox="-30 -4 270 208" aria-hidden="true">
      <Glow />
      <Side side="front" worked={worked} />
      <Side side="back" worked={worked} x={110} />
    </svg>
  );
}
