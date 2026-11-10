/** Pure helpers of the profile (tested without a phone). */
import type { Me } from '@zankup/core';

export function initials(me: Me): string {
  const name = me.display_name ?? me.email;
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

/** Whole years from a date of birth ("YYYY-MM-DD") to a day. */
export function ageOn(birth: string, today: Date): number {
  const [y = 0, m = 1, d = 1] = birth.split('-').map(Number);
  const before = today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d);
  return today.getFullYear() - y - (before ? 1 : 0);
}

/** "1990-04-07" is a real date. */
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** "1990-04-07" as people write it here: "07/04/1990". */
export function toDayMonthYear(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

/**
 * What is typed in a date field, as it should read while typing: only digits, with the slashes put in
 * ("14081982" becomes "14/08/1982").
 */
export function typeDayMonthYear(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/');
}

/** "14/08/1982" (or "14-8-1982", "14.08.1982") as "1982-08-14", or null when it is no real date. */
export function fromDayMonthYear(text: string): string | null {
  const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text.trim());
  if (!match) return null;
  const iso = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  return validDate(iso) ? iso : null;
}
