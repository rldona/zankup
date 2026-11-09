/** Date arithmetic for the calendar and the reviews (OS-520, OS-521). Pure, so it is unit-tested. */

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The Monday-to-Sunday weeks that cover a month: [first day, the day after the last]. */
export function monthGrid(year: number, month: number): [string, string] {
  const first = new Date(year, month - 1, 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const end = new Date(year, month, 1);
  end.setDate(end.getDate() + ((7 - ((end.getDay() + 6) % 7)) % 7));
  return [iso(start), iso(end)];
}

/** The month ("2026-11") or year ("2026") `by` periods away. */
export function shiftPeriod(period: 'month' | 'year', value: string, by: number): string {
  if (period === 'year') return String(Number(value) + by);
  const [y, m] = value.split('-').map(Number);
  const d = new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The change from `before` to `now` as "+12 %", or null when there was nothing before. */
export function change(now: number, before: number): string | null {
  if (!before) return null;
  const pct = Math.round(((now - before) / before) * 100);
  return `${pct > 0 ? '+' : ''}${pct} %`;
}
