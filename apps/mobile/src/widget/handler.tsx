import {
  activitiesQuery,
  fitnessQuery,
  formatActivityDate,
  formatDuration,
  formatters,
  localStart,
  usesPace,
  type ApiClient,
  type Sport,
} from '@zankup/core';
import { Appearance } from 'react-native';
import { requestWidgetUpdate, type WidgetTaskHandlerProps } from 'react-native-android-widget';

import { locale, t } from '../i18n';
import { storage } from '../storage';
import { EMPTY, LatestWidget, type WidgetSnapshot } from './Latest';

const KEY = 'zankup.widget';
const NAME = 'Latest';

async function snapshot(): Promise<WidgetSnapshot> {
  const saved = await storage.getItem(KEY);
  return saved ? ({ ...EMPTY, ...JSON.parse(saved) } as WidgetSnapshot) : EMPTY;
}

/** Android asks the widget to draw (added, updated, resized): from the last snapshot. */
export async function widgetTaskHandler({
  widgetAction,
  renderWidget,
}: WidgetTaskHandlerProps): Promise<void> {
  if (widgetAction === 'WIDGET_DELETED') return;
  renderWidget(<LatestWidget snapshot={await snapshot()} />);
}

/** Builds a new snapshot from the API and redraws the widgets on the home screen. */
export async function refreshWidget(api: ApiClient): Promise<void> {
  const format = formatters({ locale, units: 'metric' });
  const page = await activitiesQuery(api, undefined, 1).queryFn({ pageParam: undefined });
  const latest = page.items[0];
  const today = new Date();
  const from = new Date(today.getTime() - 3 * 86_400_000).toISOString().slice(0, 10);
  const days = await fitnessQuery(api, { from })
    .queryFn({})
    .catch(() => []);
  const form = days.at(-1);
  const sport = (latest?.sport ?? 'other') as Sport;
  const moving = latest ? (latest.moving_s ?? latest.duration_s) : 0;
  const next: WidgetSnapshot = {
    activityId: latest?.id ?? null,
    title: latest ? (latest.name ?? t(`sport.${sport}`)) : 'Zankup',
    subtitle: latest ? formatActivityDate(localStart(latest.start_utc, latest.timezone), locale) : '',
    figures: latest
      ? [
          latest.distance_m ? format.distance(latest.distance_m) : null,
          formatDuration(moving),
          latest.distance_m && moving ? format.speedFor(latest.distance_m / moving, usesPace(sport)) : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : '',
    formLabel: form ? t('stats.tsb') : '',
    formValue: form ? `${form.tsb > 0 ? '+' : ''}${Math.round(form.tsb)}` : '',
    dark: Appearance.getColorScheme() !== 'light',
  };
  await storage.setItem(KEY, JSON.stringify(next));
  await requestWidgetUpdate({ widgetName: NAME, renderWidget: () => <LatestWidget snapshot={next} /> });
}
