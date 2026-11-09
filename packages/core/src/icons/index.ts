import type { Sport } from '../domain/sports';
import type { MaterialIcon } from './material';

export * from './material';
export * from './sources';

/** The icon of each sport Zankup groups activities into, shared by the PWA and the Android app. */
export const SPORT_ICONS: Record<Sport, MaterialIcon> = {
  run: 'directions_run',
  ride: 'directions_bike',
  strength: 'exercise',
  walk: 'directions_walk',
  row: 'rowing',
  swim: 'pool',
  other: 'sports',
};
