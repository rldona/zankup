import type { SearchParams, Units } from '@zankup/core';

/**
 * The search lives in the URL (OS-219), so it can be shared, bookmarked and come back with "back".
 * These turn the URL's short keys into the API's filters, in metres, seconds and ISO dates.
 */

const METRES = { metric: 1000, imperial: 1609.344 } as const;

const number = (value: string | null) => {
  if (value == null || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/** Local midnight of a day, as an instant the API understands. */
const day = (iso: string) => new Date(`${iso}T00:00:00`).toISOString();

function nextDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The period's start and end (exclusive) as local midnight, or nothing. */
export function periodRange(url: URLSearchParams, today: Date): { from?: string; to?: string } {
  const period = url.get('period') ?? 'all';
  const year = today.getFullYear();
  if (period === 'year') return { from: day(`${year}-01-01`) };
  if (period === 'last12') {
    const start = new Date(today);
    start.setFullYear(year - 1);
    return { from: day(start.toISOString().slice(0, 10)) };
  }
  if (/^\d{4}$/.test(period)) return { from: day(`${period}-01-01`), to: day(`${Number(period) + 1}-01-01`) };
  if (period === 'custom') {
    const from = url.get('from');
    const to = url.get('to');
    return { from: from ? day(from) : undefined, to: to ? day(nextDay(to)) : undefined };
  }
  return {};
}

export function apiParams(url: URLSearchParams, units: Units, today: Date): SearchParams {
  const scale = METRES[units];
  const distance = (key: string) => {
    const n = number(url.get(key));
    return n == null ? undefined : n * scale;
  };
  const minutes = (key: string) => {
    const n = number(url.get(key));
    return n == null ? undefined : n * 60;
  };
  const range = periodRange(url, today);
  const params: SearchParams = {
    q: url.get('q')?.trim() || undefined,
    sport: url.getAll('sport').length ? url.getAll('sport') : undefined,
    source: url.getAll('source').length ? url.getAll('source') : undefined,
    from: range.from,
    to: range.to,
    min_distance: distance('dmin'),
    max_distance: distance('dmax'),
    min_duration: minutes('tmin'),
    max_duration: minutes('tmax'),
    min_ascent: number(url.get('amin')),
    min_hr: number(url.get('hmin')),
    max_hr: number(url.get('hmax')),
    with_record: url.get('record') === '1' || undefined,
    with_description: url.get('desc') === '1' || undefined,
    with_gps: url.get('gps') === '1' || undefined,
    sort: url.get('sort') ?? undefined,
    order: url.get('order') ?? undefined,
  };
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)) as SearchParams;
}

/** The URL keys that are filters (not the text, the sort or the order): what the chips show. */
export const FILTER_KEYS = [
  'sport',
  'period',
  'dmin',
  'dmax',
  'tmin',
  'tmax',
  'amin',
  'hmin',
  'hmax',
  'record',
  'desc',
  'gps',
  'source',
] as const;
