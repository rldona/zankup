/**
 * Stats' summary against the same period a year before (as paired bars, app and web): the change in
 * percent and how long each bar is, the larger of the two filling the row.
 */
export type Comparison = {
  /** Whole percent, or null when there was nothing a year before. */
  percent: number | null;
  /** This period's bar and last year's, as a share of the row (0–1). */
  now: number;
  before: number;
};

export function compare(now: number, before: number): Comparison {
  const top = Math.max(now, before);
  return {
    percent: before ? Math.round(((now - before) / before) * 100) : null,
    now: top ? now / top : 0,
    before: top ? before / top : 0,
  };
}

/**
 * The years the summary's key names, last year's first: the period's own year is that of its last
 * day (`to` is exclusive), so 2026 for a year, a month or the last twelve months ending in 2026.
 */
export function comparisonYears(range: { to: string }): [number, number] {
  const [y = 1970, m = 1, d = 1] = range.to.split('-').map(Number);
  const year = new Date(Date.UTC(y, m - 1, d - 1)).getUTCFullYear();
  return [year - 1, year];
}
