/**
 * The activity's figures under its title (OS-518, OS-908): the six that matter, as Strava lays them out,
 * and the rest behind "More". Shared by the app and the web, which only lay them out.
 */
import type { ActivityDetail } from '../api/queries';
import type { formatters } from '../format';
import { formatDuration } from '../format';
import type { MessageKey } from '../i18n';

type Format = ReturnType<typeof formatters>;
type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export function activityFigures(
  a: ActivityDetail,
  { pace, format, t, locale }: { pace: boolean; format: Format; t: Translate; locale: string },
): { main: [string, string][]; more: [string, string][] } {
  const moving = a.moving_s ?? a.duration_s;
  const m = a.metrics ?? null;
  const main: [string, string][] = [];
  const more: [string, string][] = [];
  if (a.distance_m) main.push([t('activity.fig.distance'), format.distance(a.distance_m)]);
  main.push([t('activity.fig.moving'), formatDuration(moving)]);
  if (a.distance_m && moving)
    main.push([
      t(pace ? 'activity.fig.pace' : 'activity.fig.speed'),
      format.speedFor(a.distance_m / moving, pace),
    ]);
  if (a.ascent_m) main.push([t('activity.fig.ascent'), format.elevation(a.ascent_m)]);
  if (a.avg_power) main.push([t('activity.power'), `${a.avg_power} W`]);
  else if (a.avg_hr) main.push([t('feed.stat.hr'), `${a.avg_hr} bpm`]);
  const kcal = a.calories ?? m?.calories;
  if (kcal)
    main.push([
      t('activity.calories'),
      `${Math.round(kcal).toLocaleString(locale)} kcal${a.calories == null ? ' *' : ''}`,
    ]);
  if (a.moving_s && a.duration_s - a.moving_s > 60)
    more.push([t('activity.elapsed'), formatDuration(a.duration_s)]);
  if (a.avg_power && a.avg_hr) more.push([t('feed.stat.hr'), `${a.avg_hr} bpm`]);
  if (a.max_hr) more.push([t('activity.maxHr'), `${a.max_hr} bpm`]);
  if (a.normalized_power) more.push([t('activity.np'), `${a.normalized_power} W`]);
  if (m?.trimp != null) more.push([t('activity.effort'), Math.round(m.trimp).toLocaleString(locale)]);
  if (pace && m?.gap_speed) more.push([t('activity.gap'), format.pace(m.gap_speed)]);
  if (m?.decoupling != null)
    more.push([
      t('activity.decoupling'),
      `${m.decoupling.toLocaleString(locale, { maximumFractionDigits: 1 })} %`,
    ]);
  if (a.training_effect)
    more.push([t('activity.te'), a.training_effect.toLocaleString(locale, { maximumFractionDigits: 1 })]);
  // Without a distance (strength, indoor), the next figures fill the six places.
  main.push(...more.splice(0, Math.max(0, 6 - main.length)));
  return { main, more };
}
