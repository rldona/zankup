/**
 * Stats' summary against the same period a year before (as paired bars, app and web): the change in
 * percent and how long each bar is, the larger of the two filling the row.
 */
import type { MessageKey } from '../i18n';

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

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

const day = (iso: string) => {
  const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const month = (date: Date, locale: string, year = true) =>
  date.toLocaleDateString(locale, { month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });

/**
 * What the summary's key calls the two periods it compares, last year's first, from the range Stats
 * shows (`to` is exclusive): a year ("2025", "2026"), whole months ("mar 2025", "mar 2026", or
 * "mar–jun 2025"), any other span of up to a year ("12 months before", "Last 12 months"). Null for a
 * span longer than a year (All): against a year earlier it compares nothing that means anything.
 */
export function comparisonLabels(
  range: { from: string; to: string },
  locale: string,
  t: Translate,
): [string, string] | null {
  const from = day(range.from);
  const to = day(range.to);
  const last = new Date(to.getTime() - 86_400_000); // the period's last day
  if ((to.getTime() - from.getTime()) / 86_400_000 > 366) return null;
  const firstOfMonth = (d: Date) => d.getUTCDate() === 1;
  if (firstOfMonth(from) && firstOfMonth(to)) {
    const back = (d: Date) => new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate()));
    if (
      from.getUTCMonth() === 0 &&
      to.getUTCMonth() === 0 &&
      to.getUTCFullYear() === from.getUTCFullYear() + 1
    ) {
      const year = from.getUTCFullYear();
      return [String(year - 1), String(year)];
    }
    const name = (start: Date, end: Date) =>
      start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear()
        ? month(start, locale)
        : start.getUTCFullYear() === end.getUTCFullYear()
          ? `${month(start, locale, false)}–${month(end, locale)}`
          : `${month(start, locale)}–${month(end, locale)}`;
    return [name(back(from), back(last)), name(from, last)];
  }
  return [t('stats.compare.before'), t('stats.compare.now')];
}
