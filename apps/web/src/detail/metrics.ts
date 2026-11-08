import type { Metric } from '@zankup/core';

/** The token each metric is drawn with in the profile. */
export const METRIC_COLOUR: Record<Metric, string> = {
  speed: 'accent',
  hr: 'zone5',
  power: 'ride',
  alt: 'muted',
};
