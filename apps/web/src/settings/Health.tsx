import {
  healthSettingsQuery,
  type HealthMetric,
  type HealthSettings,
  type HealthSourceName,
  type MessageKey,
} from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router';

import { api } from '../api';
import { locale, t } from '../i18n';
import { sourceName } from '../health/names';
import { Select } from '../Select';
import { CardTitle } from '../ui';

const METRICS: HealthMetric[] = ['sleep', 'hrv', 'resting_hr', 'spo2', 'respiration', 'steps'];
const RESULTS: Record<string, { text: MessageKey; ok: boolean }> = {
  connected: { text: 'health.google.connected', ok: true },
  cancelled: { text: 'health.google.cancelled', ok: false },
  error: { text: 'health.google.error', ok: false },
};

/** What to say about a source that has sent nothing yet. */
function hint(s: HealthSettings['sources'][number]) {
  if (s.source === 'health_connect') return t('health.hc.note');
  if (!s.available) return t(s.source === 'garmin' ? 'settings.garminOff' : 'health.google.off');
  return s.source === 'garmin' ? t('settings.never') : t('health.google.note');
}

const when = (iso: string | null) =>
  iso
    ? t('settings.lastSync', {
        date: new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }),
      })
    : t('settings.never');

/**
 * Settings → Health (OS-603, OS-605, OS-607): each source's state (Garmin, Google Health, Health
 * Connect from the Android app), connecting Google Health, the source to prefer per metric, and
 * deleting what one source sent.
 */
export function HealthSources() {
  const settings = useQuery(healthSettingsQuery(api));
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const refresh = (data?: HealthSettings) => {
    if (data) queryClient.setQueryData(healthSettingsQuery(api).queryKey, data);
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
  const { hash } = useLocation();
  const loaded = settings.isSuccess;
  useEffect(() => {
    // Back from Google (or a notification) lands on #health once the section exists.
    if (loaded && hash === '#health') document.getElementById('health')?.scrollIntoView();
  }, [loaded, hash]);
  if (!settings.data) return null;
  const result = RESULTS[params.get('health') ?? ''];
  // Sources worth preferring: those that sent something, or are connected now.
  const usable = settings.data.sources.filter((s) => s.connected || s.nights + s.days > 0);

  return (
    <>
      <h2 id="health">{t('health.settings')}</h2>
      {result && (
        <p className={result.ok ? 'ok' : 'warn'} role="status">
          {t(result.text)}
        </p>
      )}
      <ul className="rows">
        {settings.data.sources.map((s) => (
          <li key={s.source}>
            <span>
              {sourceName(s.source)}
              <small className="note">
                {s.connected || s.nights + s.days > 0
                  ? `${when(s.last_sync_at)} · ${t('health.counts', { nights: s.nights, days: s.days })}`
                  : hint(s)}
                {s.source === 'google_health' && !s.available && (s.connected || s.nights + s.days > 0)
                  ? ` ${t('health.google.off')}`
                  : ''}
                {s.needs_reconnect && ` ${t('health.google.reconnect')}`}
                {(s.missing ?? []).length > 0 && ` ${t('health.google.missing')}`}
              </small>
            </span>
            <div className="actions">
              {s.source === 'google_health' && s.available && (!s.connected || s.needs_reconnect) && (
                <a className="button primary" href="/api/wellness/google/start">
                  {t(s.connected ? 'health.google.reconnectButton' : 'health.google.connect')}
                </a>
              )}
              {s.source === 'google_health' && s.connected && (
                <button type="button" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>
                  {t('health.google.disconnect')}
                </button>
              )}
              {s.nights + s.days > 0 && (
                <button
                  type="button"
                  disabled={wipe.isPending}
                  onClick={() => {
                    if (window.confirm(t('health.deleteConfirm', { source: sourceName(s.source) })))
                      wipe.mutate(s.source);
                  }}
                >
                  {t('health.deleteData')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {usable.length > 1 && (
        <>
          <h3>{t('health.priority')}</h3>
          <p className="note">{t('health.priorityNote')}</p>
          <ul className="rows">
            {METRICS.map((metric) => (
              <li key={metric}>
                <span>{t(`health.metric.${metric}` as MessageKey)}</span>
                <div className="prefer">
                  <Select
                    label={t(`health.metric.${metric}` as MessageKey)}
                    value={settings.data.priority[metric]?.[0] ?? ''}
                    onChange={(value) =>
                      priority.mutate({
                        [metric]: value ? [value as HealthSourceName] : [],
                      })
                    }
                    options={[
                      { value: '', label: t('health.automatic') },
                      ...usable.map((s) => ({ value: s.source, label: sourceName(s.source) })),
                    ]}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/**
 * Bringing a year of health history (OS-917), as the app's Settings › Health: Garmin and Google Health
 * fetch their last year in the background (`POST /api/wellness/history`), and Health shows it as it
 * arrives. Health Connect's history is read on the phone.
 */
export function HealthHistory() {
  const queryClient = useQueryClient();
  const bring = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST('/api/wellness/history');
      if (error) throw new Error('history');
      return data?.queued ?? [];
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['wellness'] }),
  });
  return (
    <section className="panel">
      <CardTitle>{t('health.history.title')}</CardTitle>
      <p className="note">{t('health.history.noteWeb')}</p>
      <div className="actions">
        <button type="button" disabled={bring.isPending} onClick={() => bring.mutate()}>
          {bring.isPending ? t('health.history.working') : t('health.history.bring')}
        </button>
      </div>
      {bring.isSuccess && (
        <p className="note" role="status">
          {bring.data.length
            ? t('health.history.queued', {
                sources: bring.data.map((s) => t(`health.source.${s}` as MessageKey)).join(', '),
              })
            : t('health.history.none')}
        </p>
      )}
      {bring.isError && (
        <p className="note" role="alert">
          {t('common.error')}
        </p>
      )}
    </section>
  );
}
