/**
 * The sections of Settings on the phone (OS-522), as in the PWA: heart rate and zones, which
 * notifications, personal MCP tokens, exporting your data, Garmin and the signed-in devices.
 */
import {
  apiTokensQuery,
  devicesQuery,
  engineQuery,
  estimatesQuery,
  exportsQuery,
  settingsQuery,
  sourcesQuery,
  type ApiTokenCreated,
  type NotificationPrefs,
} from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Linking, Share, Text, View } from 'react-native';

import { useApi, useAuth } from '../auth';
import { locale, t } from '../i18n';
import { registerPush, unregisterPush, type PushResult } from '../push';
import { instanceUrl } from '../session';
import { useTheme } from '../theme';
import { Badge, Button, Card, Choice, Field, Heading, ListRow, Muted, SwitchRow } from '../ui';
import { numberOrNull, useSaveSettings } from './save';

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

const moment = (iso: string) =>
  new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });

// --- heart rate and zones --------------------------------------------------------------------------

export function HeartRate() {
  const api = useApi();
  const settings = useQuery(settingsQuery(api));
  if (!settings.data) return null;
  // Keyed by the saved values, so the form starts again from them after a save or a refetch.
  return (
    <HeartRateForm
      key={`${settings.data.hr_max}-${settings.data.hr_rest}`}
      hrMax={settings.data.hr_max}
      hrRest={settings.data.hr_rest}
      estimate={settings.data.hr_max_estimate}
    />
  );
}

function HeartRateForm({
  hrMax,
  hrRest,
  estimate,
}: {
  hrMax: number | null;
  hrRest: number | null;
  estimate: number | null;
}) {
  const save = useSaveSettings();
  const [max, setMax] = useState(hrMax?.toString() ?? '');
  const [rest, setRest] = useState(hrRest?.toString() ?? '');
  return (
    <Card>
      <Heading>{t('settings.heart')}</Heading>
      <Muted>{estimate ? t('settings.hrHelp', { estimate }) : t('settings.hrHelpNone')}</Muted>
      <Field
        label={t('settings.hrMax')}
        keyboardType="number-pad"
        placeholder={estimate?.toString() ?? ''}
        value={max}
        onChangeText={setMax}
      />
      <Field label={t('settings.hrRest')} keyboardType="number-pad" value={rest} onChangeText={setRest} />
      <Button
        primary
        disabled={save.isPending}
        onPress={() => save.mutate({ hr_max: numberOrNull(max), hr_rest: numberOrNull(rest) })}
      >
        {t('settings.save')}
      </Button>
      {save.isSuccess && <Muted accessibilityRole="alert">{t('settings.saved')}</Muted>}
      {save.isError && <Muted accessibilityRole="alert">{save.error.message || t('common.error')}</Muted>}
    </Card>
  );
}

/** Zone model, threshold HR and FTP (OS-301): changing them recomputes everything in the background. */
export function Zones() {
  const api = useApi();
  const queryClient = useQueryClient();
  const settings = useQuery(settingsQuery(api));
  const estimates = useQuery(estimatesQuery(api));
  const engine = useQuery({
    ...engineQuery(api),
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });
  const save = useSaveSettings();
  const recompute = useMutation({
    mutationFn: async () => {
      await api.POST('/api/engine/recompute');
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: engineQuery(api).queryKey }),
  });
  if (!settings.data) return null;
  const estimate = (kind: string) => estimates.data?.find((e) => e.kind === kind)?.value;
  const lthr = estimate('lthr');
  const ftp = estimate('ftp');
  return (
    <Card>
      <Heading>{t('settings.zones')}</Heading>
      <Muted>{t('settings.recomputeNote')}</Muted>
      <Choice
        label={t('settings.zoneModel')}
        value={settings.data.zone_model}
        onChange={(zone_model) => save.mutate({ zone_model })}
        options={[
          { value: 'max', label: t('settings.zone.max') },
          { value: 'reserve', label: t('settings.zone.reserve') },
          { value: 'lthr', label: t('settings.zone.lthr') },
        ]}
      />
      <ThresholdField
        key={`lthr-${settings.data.lthr}`}
        label={t('settings.lthr')}
        saved={settings.data.lthr}
        estimate={lthr ? `${Math.round(lthr)} bpm` : null}
        onSave={(value) => save.mutate({ lthr: value })}
      />
      <ThresholdField
        key={`ftp-${settings.data.ftp}`}
        label={t('settings.ftp')}
        saved={settings.data.ftp}
        estimate={ftp ? `${Math.round(ftp)} W` : null}
        onSave={(value) => save.mutate({ ftp: value })}
      />
      <Button onPress={() => recompute.mutate()} disabled={recompute.isPending || engine.data?.running}>
        {t('settings.recompute')}
      </Button>
      {engine.data?.running && (
        <Muted accessibilityRole="alert">
          {t('stats.recomputing', { done: engine.data.done, total: engine.data.total })}
        </Muted>
      )}
      {save.isError && <Muted accessibilityRole="alert">{save.error.message || t('common.error')}</Muted>}
    </Card>
  );
}

/** Saved when the field loses focus, as in the PWA; the estimate shows as the placeholder. */
function ThresholdField({
  label,
  saved,
  estimate,
  onSave,
}: {
  label: string;
  saved: number | null;
  estimate: string | null;
  onSave: (value: number | null) => void;
}) {
  const [value, setValue] = useState(saved?.toString() ?? '');
  return (
    <View style={{ gap: 4 }}>
      <Field
        label={label}
        keyboardType="number-pad"
        value={value}
        placeholder={estimate?.replace(/\D+$/, '').trim() ?? ''}
        onChangeText={setValue}
        onEndEditing={() => {
          const next = numberOrNull(value);
          if (next !== saved) onSave(next);
        }}
      />
      {estimate && <Muted>{t('settings.estimated', { value: estimate })}</Muted>}
    </View>
  );
}

// --- notifications ---------------------------------------------------------------------------------

const KINDS = ['activity', 'record', 'sync_error', 'garmin_key', 'estimate', 'import', 'weekly'] as const;

/** This phone on or off (OS-507), a test, and which kinds (shared with the PWA). */
export function Notifications() {
  const api = useApi();
  const settings = useQuery(settingsQuery(api));
  const save = useSaveSettings();
  const [push, setPush] = useState<PushResult | 'off' | null>(null);
  const test = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST('/api/notifications/test');
      if (error) throw new Error('test');
    },
  });
  const prefs = settings.data?.notifications;
  return (
    <>
      <Card>
        <Heading>{t('notifications.title')}</Heading>
        <Muted>{t('mobile.pushHelp')}</Muted>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button primary onPress={() => void registerPush(api).then(setPush)}>
            {t('mobile.pushOn')}
          </Button>
          <Button onPress={() => void unregisterPush(api).then(() => setPush('off'))}>
            {t('mobile.pushOff')}
          </Button>
          <Button onPress={() => test.mutate()} disabled={test.isPending}>
            {t('notifications.test')}
          </Button>
        </View>
        {push && <Muted accessibilityRole="alert">{t(`mobile.push.${push}`)}</Muted>}
        {test.isSuccess && <Muted accessibilityRole="alert">{t('notifications.sent')}</Muted>}
        {test.isError && <Muted accessibilityRole="alert">{t('common.error')}</Muted>}
      </Card>
      {prefs && (
        <Card>
          <Heading>{t('notifications.which')}</Heading>
          {KINDS.map((kind) => (
            <SwitchRow
              key={kind}
              label={t(`notifications.kind.${kind}`)}
              value={prefs[kind]}
              disabled={save.isPending}
              onChange={(on) => save.mutate({ notifications: { ...prefs, [kind]: on } as NotificationPrefs })}
            />
          ))}
        </Card>
      )}
    </>
  );
}

// --- MCP tokens ------------------------------------------------------------------------------------

/** Personal tokens for the read-only MCP server (OS-709): create one (shown once), list and revoke. */
export function Mcp() {
  const api = useApi();
  const c = useTheme();
  const queryClient = useQueryClient();
  const tokens = useQuery(apiTokensQuery(api));
  const [name, setName] = useState('');
  const [created, setCreated] = useState<ApiTokenCreated | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: apiTokensQuery(api).queryKey });
  const create = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await api.POST('/api/ai/tokens', { body: { name } });
      if (!data) throw new Error(String((error as { detail?: unknown } | undefined)?.detail ?? 'error'));
      return data;
    },
    onSuccess: (data) => {
      setCreated(data);
      setName('');
      refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await api.DELETE('/api/ai/tokens/{token_id}', { params: { path: { token_id: id } } });
      if (error) throw new Error('revoke');
    },
    onSuccess: () => {
      setCreated(null);
      refresh();
    },
  });
  const base = instanceUrl() ?? '';
  const url = created?.url ? new URL(created.url, base).toString() : `${base}/api/mcp`;
  return (
    <Card>
      <Heading>{t('mcp.title')}</Heading>
      <Muted>{t('mcp.help')}</Muted>
      <Muted>
        {t('mcp.url')}: <Text style={{ color: c.fg, fontFamily: 'monospace' }}>{url}</Text>
      </Muted>
      <Field label={t('mcp.name')} value={name} onChangeText={setName} maxLength={120} placeholder="Claude" />
      <Button primary disabled={create.isPending || !name.trim()} onPress={() => create.mutate(name.trim())}>
        {t('mcp.create')}
      </Button>
      {create.isError && <Muted accessibilityRole="alert">{t('common.error')}</Muted>}
      {created && (
        <View style={{ gap: 8 }} accessibilityRole="alert">
          <Muted>{t('mcp.created')}</Muted>
          <Text selectable style={{ color: c.fg, fontFamily: 'monospace' }}>
            {created.token}
          </Text>
          <Button onPress={() => void Share.share({ message: created.token })}>{t('mobile.share')}</Button>
        </View>
      )}
      {tokens.data?.length === 0 && <Muted>{t('mcp.none')}</Muted>}
      {tokens.data?.map((token) => (
        <ListRow
          key={token.id}
          title={token.name}
          note={`${token.prefix}… · ${
            token.last_used_at ? t('mcp.lastUsed', { date: day(token.last_used_at) }) : t('mcp.neverUsed')
          }`}
        >
          <Button
            disabled={revoke.isPending}
            onPress={() =>
              Alert.alert(token.name, t('mcp.revokeConfirm'), [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('mcp.revoke'), style: 'destructive', onPress: () => revoke.mutate(token.id) },
              ])
            }
          >
            {t('mcp.revoke')}
          </Button>
        </ListRow>
      ))}
    </Card>
  );
}

// --- your data -------------------------------------------------------------------------------------

const megabytes = (bytes: number) =>
  `${(bytes / 1_048_576).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`;

/** A ZIP with everything (OS-411): prepared in the background, downloaded through the browser. */
export function ExportData() {
  const api = useApi();
  const queryClient = useQueryClient();
  const exports = useQuery({
    ...exportsQuery(api),
    refetchInterval: (q) =>
      q.state.data?.some((e) => e.status === 'queued' || e.status === 'running') ? 3000 : false,
  });
  const start = useMutation({
    mutationFn: async () => {
      await api.POST('/api/exports');
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: exportsQuery(api).queryKey }),
  });
  const latest = exports.data?.[0];
  const busy = latest?.status === 'queued' || latest?.status === 'running';
  const link = latest?.download_url ? new URL(latest.download_url, instanceUrl() ?? '').toString() : null;
  return (
    <Card>
      <Heading>{t('export.title')}</Heading>
      <Muted>{t('export.help')}</Muted>
      <Button onPress={() => start.mutate()} disabled={busy || start.isPending}>
        {t('export.start')}
      </Button>
      {busy && <Muted accessibilityRole="alert">{t('export.preparing')}</Muted>}
      {latest?.status === 'done' && link && (
        <Button primary onPress={() => void Linking.openURL(link)}>
          {t('export.download', { size: megabytes(latest.size ?? 0) })}
        </Button>
      )}
      {latest?.status === 'done' && latest.expires_at && (
        <Muted>{t('export.until', { date: day(latest.expires_at) })}</Muted>
      )}
      {latest?.status === 'error' && <Muted accessibilityRole="alert">{t('common.error')}</Muted>}
    </Card>
  );
}

// --- the account -----------------------------------------------------------------------------------

export function Garmin() {
  const api = useApi();
  const sources = useQuery(sourcesQuery(api));
  const garmin = sources.data?.find((s) => s.kind === 'garmin');
  if (!garmin) return null;
  return (
    <Card>
      <Heading>{t('settings.garmin')}</Heading>
      <View style={{ flexDirection: 'row' }}>
        <Badge tone={garmin.configured ? 'good' : 'bad'}>
          {garmin.configured ? t('settings.garminOn') : t('settings.garminOff')}
        </Badge>
      </View>
      {garmin.key_expires_on && (
        <Muted>
          {t(garmin.expiring_soon ? 'settings.garminSoon' : 'settings.garminExpires', {
            date: day(garmin.key_expires_on),
          })}
        </Muted>
      )}
      <Muted>
        {garmin.last_sync_at
          ? t('settings.lastSync', { date: moment(garmin.last_sync_at) })
          : t('settings.never')}
        {garmin.last_error ? ` ${t('settings.lastError', { error: garmin.last_error })}` : ''}
      </Muted>
    </Card>
  );
}

export function Sessions() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const devices = useQuery(devicesQuery(api));
  const close = useMutation({
    mutationFn: async (id: number) => {
      await api.DELETE('/api/auth/devices/{device_id}', { params: { path: { device_id: id } } });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: devicesQuery(api).queryKey }),
  });
  return (
    <Card>
      <Heading>{t('settings.sessions')}</Heading>
      {devices.data?.map((d) => (
        <ListRow
          key={d.id}
          title={d.name}
          note={`${t(d.platform === 'android' ? 'settings.platform.android' : 'settings.platform.web')}${
            d.last_seen ? ` · ${t('settings.lastSeen', { date: day(d.last_seen) })}` : ''
          }`}
        >
          {d.current ? (
            <Badge>{t('settings.thisDevice')}</Badge>
          ) : (
            <Button
              disabled={close.isPending}
              onPress={() =>
                Alert.alert(d.name, undefined, [
                  { text: t('common.cancel'), style: 'cancel' },
                  {
                    text: t('settings.signOutDevice'),
                    style: 'destructive',
                    onPress: () => close.mutate(d.id),
                  },
                ])
              }
            >
              {t('settings.signOutDevice')}
            </Button>
          )}
        </ListRow>
      ))}
    </Card>
  );
}
