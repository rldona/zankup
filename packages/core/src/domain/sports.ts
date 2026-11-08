/** Sports OpenSport groups activities into. Garmin and Strava types are mapped onto these on import. */
export const SPORTS = ['run', 'ride', 'strength', 'walk', 'row', 'swim', 'other'] as const;
export type Sport = (typeof SPORTS)[number];

/** Sports whose main speed figure is a pace (time per distance) rather than a speed. */
export function usesPace(sport: Sport): boolean {
  return sport === 'run' || sport === 'walk' || sport === 'swim' || sport === 'row';
}
