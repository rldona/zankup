import {
  formatHoursMinutes,
  SLEEP_LANES,
  sleepBlocks,
  sleepDurationBand,
  sleepScoreBand,
  stageTotals,
  type HealthDay,
  type HealthNight,
  type MessageKey,
} from '@zankup/core';

import { t } from '../i18n';

type Sleep = NonNullable<HealthDay['sleep']>;

const TRACK = 28;
const LABEL = 22;
const ROW = LABEL + 6 + TRACK + 14;
const trackTop = (lane: number) => lane * ROW + LABEL + 6;

/** The score and the hours asleep, side by side, each with the band it falls in. */
export function SleepTiles({ sleep }: { sleep: Sleep }) {
  const asleep = sleep.asleep_s ?? 0;
  const band = sleep.score != null ? sleepScoreBand(sleep.score) : null;
  const length = sleepDurationBand(asleep);
  return (
    <div className="sleeptiles">
      <article className="panel sleeptile">
        <p className="note">{t('health.score')}</p>
        <p className="big num">{sleep.score ?? '–'}</p>
        {band && (
          <span className={`pill tone-${band === 'excellent' || band === 'good' ? 'good' : band}`}>
            {t(`health.band.${band}`)}
          </span>
        )}
      </article>
      <article className="panel sleeptile">
        <p className="note">{t('health.duration')}</p>
        <p className="big num">{formatHoursMinutes(asleep)}</p>
        <span className={`pill tone-${length === 'met' ? 'good' : length === 'almost' ? 'fair' : 'poor'}`}>
          {t(`health.goal.${length}` as MessageKey)}
        </span>
      </article>
    </div>
  );
}

/**
 * The night's stages, one lane each (awake, REM, light, deep) with the time spent in it. A stretch is
 * a rounded block, squared off on the side a thin line joins it to the stage before or after; the
 * clock runs underneath.
 */
export function StageLanes({ night, sleep }: { night: HealthNight; sleep: Sleep }) {
  const list = sleepBlocks(night.stages);
  const spent = stageTotals(night.stages);
  const total = list.reduce((end, b) => Math.max(end, b.end), 0) || 1;
  const pct = (s: number) => `${(s / total) * 100}%`;
  const start = new Date(sleep.start_utc).getTime() + (sleep.utc_offset_s ?? 0) * 1000;
  const clock = (s: number) => {
    const d = new Date(start + s * 1000);
    return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  };
  return (
    <div className="lanes" role="img" aria-label={t('health.stagesLabel')}>
      <div className="lanebox" style={{ height: SLEEP_LANES.length * ROW - 14 }}>
        {SLEEP_LANES.map((lane, i) => (
          <span key={lane} className="lanetrack" style={{ top: trackTop(i), height: TRACK }} />
        ))}
        {list.map((b, i) => {
          const prev = list[i - 1];
          if (!prev || !b.from) return null;
          const top = Math.min(trackTop(prev.lane), trackTop(b.lane)) + TRACK;
          const bottom = Math.max(trackTop(prev.lane), trackTop(b.lane));
          return (
            <span
              key={`line-${b.start}`}
              className="lanelink"
              style={{ left: pct(b.start), top, height: bottom - top }}
            />
          );
        })}
        {list.map((b) => {
          const r = TRACK / 2;
          return (
            <span
              key={b.start}
              className={`laneblock stage-${SLEEP_LANES[b.lane] ?? 'light'}`}
              style={{
                left: pct(b.start),
                width: `max(2px, ${pct(b.end - b.start)})`,
                top: trackTop(b.lane),
                height: TRACK,
                borderRadius: [
                  b.from === 'above' ? 0 : r,
                  b.to === 'above' ? 0 : r,
                  b.to === 'below' ? 0 : r,
                  b.from === 'below' ? 0 : r,
                ]
                  .map((n) => `${n}px`)
                  .join(' '),
              }}
            />
          );
        })}
        {SLEEP_LANES.map((lane, i) => (
          <span key={lane} className="lanename" style={{ top: i * ROW }}>
            {t(`health.stage.${lane}`)} · <b className="num">{formatHoursMinutes(spent[lane])}</b>
          </span>
        ))}
      </div>
      <div className="laneclock num">
        {[0, total / 2, total].map((s) => (
          <span key={s}>{clock(s)}</span>
        ))}
      </div>
    </div>
  );
}
