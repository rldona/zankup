/**
 * Formatting for numbers the app shows everywhere. Pure functions over SI units (metres, seconds, m/s),
 * locale-aware through Intl. Units (metric or imperial) are a setting independent of the language.
 */
import type { Locale } from '../i18n';

export type Units = 'metric' | 'imperial';

export interface FormatOptions {
  locale: Locale;
  units: Units;
}

const METRES_PER_MILE = 1609.344;
const MIN_PACE_SPEED = 0.3; // m/s: slower than this there is no meaningful pace

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 3725 → "1:02:05", 305 → "5:05". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  return h ? `${h}:${pad2(m)}:${pad2(x)}` : `${m}:${pad2(x)}`;
}

/** 3725 → "1 h 2 min", 600 → "10 min". */
export function formatHoursMinutes(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

/** Distance in km or mi with two decimals, without the unit: 6615 → "6.62" (en) or "6,62" (es). */
export function formatDistance(metres: number, { locale, units }: FormatOptions): string {
  const value = units === 'metric' ? metres / 1000 : metres / METRES_PER_MILE;
  return value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function distanceUnit(units: Units): 'km' | 'mi' {
  return units === 'metric' ? 'km' : 'mi';
}

/** Pace per km or per mile from a speed in m/s: 2.93 m/s → "5:41". "—" when standing still. */
export function formatPace(metresPerSecond: number, { units }: Pick<FormatOptions, 'units'>): string {
  if (!(metresPerSecond > MIN_PACE_SPEED)) return '—';
  const unit = units === 'metric' ? 1000 : METRES_PER_MILE;
  return formatDuration(unit / metresPerSecond);
}

/** Speed in km/h or mph with one decimal: 8.33 m/s → "30" (en) or "30" (es), 8.4 → "30.2" / "30,2". */
export function formatSpeed(metresPerSecond: number, { locale, units }: FormatOptions): string {
  const value = units === 'metric' ? metresPerSecond * 3.6 : (metresPerSecond * 3600) / METRES_PER_MILE;
  return value.toLocaleString(locale, { maximumFractionDigits: 1 });
}

/** Activity start shown in its own local time: "Tue, 27 Oct · 19:05" (en-GB style) or "mar, 27 oct · 19:05". */
export function formatActivityDate(isoLocal: string, locale: Locale): string {
  const date = new Date(isoLocal.replace(' ', 'T'));
  const day = date.toLocaleDateString(locale === 'en' ? 'en-GB' : locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = date.toLocaleTimeString(locale === 'en' ? 'en-GB' : locale, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${day} · ${time}`;
}

/**
 * The activity's start in the local time where it was recorded, as "YYYY-MM-DDTHH:MM:SS" (no offset),
 * from its UTC start and the offset stored with it ("+01:00"). Without an offset, UTC is used. The same
 * rule as the API's month totals, so a card and its month header always agree.
 */
export function localStart(startUtc: string, timezone: string | null | undefined): string {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(timezone ?? '');
  const offset = match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
  const local = new Date(new Date(startUtc).getTime() + offset * 60_000);
  return local.toISOString().slice(0, 19);
}

/** "2026-10" → "October 2026" (en) or "octubre de 2026" (es). */
export function formatMonth(month: string, locale: Locale): string {
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, (index ?? 1) - 1, 1)).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Elevation in metres or feet, rounded: 123 → "123 m" or "404 ft". */
export function formatElevation(metres: number, { locale, units }: FormatOptions): string {
  const value = units === 'metric' ? metres : metres / 0.3048;
  return `${Math.round(value).toLocaleString(locale)} ${units === 'metric' ? 'm' : 'ft'}`;
}

/** Formatters with their units, for screens that show many figures. */
export function formatters(options: FormatOptions) {
  const unit = distanceUnit(options.units);
  return {
    distance: (metres: number) => `${formatDistance(metres, options)} ${unit}`,
    pace: (metresPerSecond: number) => `${formatPace(metresPerSecond, options)} /${unit}`,
    speed: (metresPerSecond: number) =>
      `${formatSpeed(metresPerSecond, options)} ${options.units === 'metric' ? 'km/h' : 'mph'}`,
    elevation: (metres: number) => formatElevation(metres, options),
    /** Pace for running-like sports, speed for the rest. */
    speedFor: (metresPerSecond: number, pace: boolean) =>
      pace
        ? `${formatPace(metresPerSecond, options)} /${unit}`
        : `${formatSpeed(metresPerSecond, options)} ${options.units === 'metric' ? 'km/h' : 'mph'}`,
    unit,
  };
}
