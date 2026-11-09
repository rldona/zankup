/**
 * The Stats period selector (OS-321): all time, the last 12 months, a year or a month, as the API's
 * `from` (inclusive) and `to` (exclusive) dates, the volume chart's bucket and the same span one
 * year earlier. Shared with the Android app.
 */

export type PeriodChoice = string; // 'all' | 'last12' | 'YYYY' | 'YYYY-MM'
export type Unit = 'day' | 'week' | 'month' | 'year';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export interface PeriodRange {
  from: string;
  to: string;
  unit: Unit;
}

export function periodOf(choice: PeriodChoice, today: Date, firstYear: number): PeriodRange {
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (/^\d{4}-\d{2}$/.test(choice)) {
    const [y = 0, m = 1] = choice.split('-').map(Number);
    return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 1)), unit: 'day' };
  }
  if (/^\d{4}$/.test(choice)) {
    const y = Number(choice);
    return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y + 1, 0, 1)), unit: 'month' };
  }
  if (choice === 'all') return { from: iso(new Date(firstYear, 0, 1)), to: iso(tomorrow), unit: 'year' };
  const start = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate() + 1);
  return { from: iso(start), to: iso(tomorrow), unit: 'month' };
}
