import type { Series } from '@zankup/core';
import { useEffect, useRef, useState } from 'react';

import { reducedMotion } from '../charts/inView';

export const SPEEDS = [10, 30, 100] as const;

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

export type ReplaySpeed = (typeof SPEEDS)[number];

/**
 * Activity replay (OS-414): moves the shared cursor (map marker and charts) along the activity at 10×
 * to 100×, with pause and seeking. With reduced motion it advances in steps once a second instead of
 * every frame. A hook, so the play button can sit on the map and the speed in the map's options.
 */
export function useReplay(series: Series, index: number | null, onIndex: (index: number | null) => void) {
  const times = series.t;
  const total = times[times.length - 1] ?? 0;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(30);
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

  return {
    usable: times.length > 1,
    playing,
    speed,
    setSpeed,
    current,
    total,
    toggle: () => {
      if (!playing && position.current >= total) position.current = 0;
      if (!playing && index != null) position.current = times[index] ?? 0;
      setPlaying(!playing);
    },
    seek: (seconds: number) => {
      position.current = seconds;
      onIndex(indexAt(times, seconds));
    },
  };
}

export type Replay = ReturnType<typeof useReplay>;
