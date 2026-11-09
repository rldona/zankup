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

/** Target in the unit people think in (km or mi, hours, a count), saved in metres, seconds or a count. */
export function goalTarget(metric: 'distance' | 'time' | 'count', value: number, unit: string): number {
  if (metric === 'distance') return value * (unit === 'km' ? 1000 : 1609.344);
  return metric === 'time' ? value * 3600 : value;
}
