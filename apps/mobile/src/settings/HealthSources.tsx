/**
 * Settings → Health on the phone (OS-522), as in the PWA (OS-603, OS-605): each source's state,
 * disconnecting Google Health, the source to prefer per metric, and deleting what one source sent.
 * Connecting Google Health needs the web (its sign-in comes back to the browser).
 */
import {
  healthSettingsQuery,
  type HealthMetric,
  type HealthSettings,
  type HealthSourceName,
  type MessageKey,
} from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, View } from 'react-native';

import { useApi } from '../auth';
import { locale, t } from '../i18n';
import { Button, Card, Choice, Heading, ListRow, Muted } from '../ui';

const METRICS: HealthMetric[] = ['sleep', 'hrv', 'resting_hr', 'spo2', 'respiration', 'steps'];

const sourceName = (source: HealthSourceName) => t(`health.source.${source}` as MessageKey);

type Source = HealthSettings['sources'][number];

/** What to say about a source that has sent nothing yet. */
function hint(s: Source) {
  if (s.source === 'health_connect') return t('health.hc.note');
  if (!s.available) return t(s.source === 'garmin' ? 'settings.garminOff' : 'health.google.off');
  return s.source === 'garmin' ? t('settings.never') : t('mobile.googleHealthOnWeb');
}

const when = (iso: string | null) =>
  iso
    ? t('settings.lastSync', {
        date: new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }),
      })
    : t('settings.never');

function note(s: Source): string {
  const sent = s.nights + s.days > 0;
  const parts = [
    sent || s.connected
      ? `${when(s.last_sync_at)} · ${t('health.counts', { nights: s.nights, days: s.days })}`
      : hint(s),
  ];
  if (s.source === 'google_health' && !s.available && (s.connected || sent))
    parts.push(t('health.google.off'));
  if (s.needs_reconnect) parts.push(t('health.google.reconnect'));
  if ((s.missing ?? []).length > 0) parts.push(t('health.google.missing'));
  return parts.join(' ');
}

export function HealthSources() {
  const api = useApi();
  const queryClient = useQueryClient();
  const settings = useQuery(healthSettingsQuery(api));
  const refresh = (data?: HealthSettings) => {
    if (data) queryClient.setQueryData(healthSettingsQuery(api).queryKey, data);
    void queryClient.invalidateQueries({ queryKey: healthSettingsQuery(api).queryKey });
    void queryClient.invalidateQueries({ queryKey: ['wellness'] });
  };
  const priority = useMutation({
    mutationFn: async (body: Record<string, HealthSourceName[]>) =>
      (await api.PUT('/api/wellness/priority', { body: { priority: body } })).data,
    onSuccess: refresh,
  });
  const disconnect = useMutation({
    mutationFn: async () => api.DELETE('/api/wellness/google'),
    onSuccess: () => refresh(),
  });
  const wipe = useMutation({
    mutationFn: async (source: HealthSourceName) =>
      api.DELETE('/api/wellness/sources/{source}/data', { params: { path: { source } } }),
    onSuccess: () => refresh(),
  });
  if (!settings.data) return null;
  const usable = settings.data.sources.filter((s) => s.connected || s.nights + s.days > 0);
  return (
    <>
      <Card>
        <Heading>{t('health.settings')}</Heading>
        {settings.data.sources.map((s) => (
          <View key={s.source} style={{ gap: 6 }}>
            <ListRow title={sourceName(s.source)} note={note(s)} />
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {s.source === 'google_health' && s.connected && (
                <Button disabled={disconnect.isPending} onPress={() => disconnect.mutate()}>
                  {t('health.google.disconnect')}
                </Button>
              )}
              {s.nights + s.days > 0 && (
                <Button
                  disabled={wipe.isPending}
                  onPress={() =>
                    Alert.alert(
                      sourceName(s.source),
                      t('health.deleteConfirm', { source: sourceName(s.source) }),
                      [
                        { text: t('common.cancel'), style: 'cancel' },
                        {
                          text: t('health.deleteData'),
                          style: 'destructive',
                          onPress: () => wipe.mutate(s.source),
                        },
                      ],
                    )
                  }
                >
                  {t('health.deleteData')}
                </Button>
              )}
            </View>
          </View>
        ))}
      </Card>
      {usable.length > 1 && (
        <Card>
          <Heading>{t('health.priority')}</Heading>
          <Muted>{t('health.priorityNote')}</Muted>
          {METRICS.map((metric) => (
            <View key={metric} style={{ gap: 6 }}>
              <Muted>{t(`health.metric.${metric}` as MessageKey)}</Muted>
              <Choice
                scroll
                label={t(`health.metric.${metric}` as MessageKey)}
                value={settings.data.priority[metric]?.[0] ?? ''}
                onChange={(value) => priority.mutate({ [metric]: value ? [value as HealthSourceName] : [] })}
                options={[
                  { value: '', label: t('health.automatic') },
                  ...usable.map((s) => ({ value: s.source as string, label: sourceName(s.source) })),
                ]}
              />
            </View>
          ))}
        </Card>
      )}
    </>
  );
}
