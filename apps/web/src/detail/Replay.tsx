import { formatDuration, type Series } from '@zankup/core';
import { useEffect, useRef, useState } from 'react';

import { reducedMotion } from '../charts/inView';
import { t } from '../i18n';

const SPEEDS = [10, 30, 100] as const;

/** The sample at time `seconds` (the last one not after it). */
function indexAt(times: number[], seconds: number): number {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((times[mid] ?? 0) <= seconds) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Activity replay (OS-414): moves the shared cursor (map marker, profile and readout) along the
 * activity at 10× to 100×, with pause and seeking. With reduced motion it advances in steps once a
 * second instead of every frame.
 */
export function Replay({
  series,
  index,
  onIndex,
}: {
  series: Series;
  index: number | null;
  onIndex: (index: number | null) => void;
}) {
  const times = series.t;
  const total = times[times.length - 1] ?? 0;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(30);
  const position = useRef(0);
  const current = index != null ? (times[index] ?? 0) : 0;

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let frame = 0;
    let timer = 0;
    const step = (now: number) => {
      position.current = Math.min(total, position.current + ((now - last) / 1000) * speed);
      last = now;
      onIndex(indexAt(times, position.current));
      if (position.current >= total) setPlaying(false);
    };
    if (reducedMotion()) {
      timer = window.setInterval(() => step(performance.now()), 1000);
    } else {
      const loop = (now: number) => {
        step(now);
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
    };
  }, [playing, speed, total, times, onIndex]);

  if (times.length < 2) return null;
  const toggle = () => {
    if (!playing && position.current >= total) position.current = 0;
    if (!playing && index != null) position.current = times[index] ?? 0;
    setPlaying(!playing);
  };
  return (
    <div className="replay" role="group" aria-label={t('replay.title')}>
      <button type="button" onClick={toggle} aria-pressed={playing}>
        {playing ? t('replay.pause') : t('replay.play')}
      </button>
      <input
        type="range"
        min={0}
        max={Math.round(total)}
        step={1}
        value={Math.round(current)}
        aria-label={t('replay.seek')}
        aria-valuetext={formatDuration(current)}
        onChange={(e) => {
          position.current = Number(e.target.value);
          onIndex(indexAt(times, position.current));
        }}
      />
      <span className="num">{formatDuration(current)}</span>
      <div className="seg" role="group" aria-label={t('replay.speed')}>
        {SPEEDS.map((s) => (
          <button key={s} type="button" aria-pressed={s === speed} onClick={() => setSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
