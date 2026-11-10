/**
 * The instance's settings from the app instead of the server's environment: the Coach's model, budget
 * and Monday hour; how often Garmin syncs; where alerts go; backups; Google Health. Each section saves
 * its own fields; a value the server would refuse comes back as a message. Hours are shown in the
 * phone's time and kept in UTC.
 */
import { instanceQuery, queryKeys, type InstanceSettings } from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useApi } from '../auth';
import { Icon } from '../Icon';
import { t } from '../i18n';
import { useTheme } from '../theme';
import { Button, Choice, Field, Muted, SwitchRow } from '../ui';
import { ServiceKeyEditor } from './ServiceKey';

type Changes = Record<string, unknown>;

/** The phone's offset from UTC, in hours (Madrid: +1 in winter, +2 in summer). */
const offsetHours = () => -new Date().getTimezoneOffset() / 60;
const toLocal = (utc: number) => (((utc + offsetHours()) % 24) + 24) % 24;
const toUtc = (local: number) => (((local - offsetHours()) % 24) + 24) % 24;
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

function useInstance() {
  const api = useApi();
  const queryClient = useQueryClient();
  const query = useQuery(instanceQuery(api));
  const save = useMutation({
    mutationFn: async (changes: Changes) => {
      const { data, error } = await api.PATCH('/api/instance', { body: changes });
      if (!data)
        throw new Error(String((error as { detail?: unknown } | undefined)?.detail ?? t('common.error')));
      return data;
    },
    onSuccess: (data: InstanceSettings) => {
      queryClient.setQueryData(instanceQuery(api).queryKey, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources });
      void queryClient.invalidateQueries({ queryKey: ['ai'] });
      void queryClient.invalidateQueries({ queryKey: ['wellness'] });
    },
  });
  const get = (name: string) => query.data?.settings.find((s) => s.name === name);
  return { data: query.data, get, save };
}

/** Where a value comes from, when it is not from the app: the server's environment or the default. */
function Origin({ source }: { source?: string }) {
  if (source === 'env') return <Muted>{t('instance.fromServer')}</Muted>;
  return null;
}

/** An hour of the day with arrows, in the phone's time. */
function HourStepper({
  label,
  utc,
  onChange,
}: {
  label: string;
  utc: number;
  onChange: (u: number) => void;
}) {
  const c = useTheme();
  const local = toLocal(utc);
  const arrow = (name: 'chevron_left' | 'chevron_right', delta: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${delta > 0 ? '+1' : '-1'}`}
      hitSlop={10}
      onPress={() => onChange(toUtc((local + delta + 24) % 24))}
    >
      <Icon name={name} color={c.fg} size={26} />
    </Pressable>
  );
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.fg, fontWeight: '600' }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        {arrow('chevron_left', -1)}
        <Text style={{ color: c.fg, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
          {hourLabel(local)}
        </Text>
        {arrow('chevron_right', 1)}
      </View>
    </View>
  );
}

function SaveRow({
  dirty,
  pending,
  onSave,
  error,
}: {
  dirty: boolean;
  pending: boolean;
  onSave: () => void;
  error?: string;
}) {
  return (
    <>
      <Button primary disabled={!dirty || pending} onPress={onSave}>
        {pending ? t('keys.checking') : t('settings.save')}
      </Button>
      {error ? <Muted accessibilityRole="alert">{error}</Muted> : null}
    </>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <View style={{ gap: 12 }}>{children}</View>;
}

const money = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Settings › Zankup Coach: the model (with its price), the monthly budget and Monday's hour. */
export function CoachSettings() {
  const { data, get, save } = useInstance();
  const model = get('ai_model');
  const budget = get('ai_monthly_budget_usd');
  const hour = get('weekly_report_hour_utc');
  const [changes, setChanges] = useState<Changes>({});
  if (!data || !model || !budget || !hour) return null;
  const value = (name: string, fallback: unknown) => (name in changes ? changes[name] : fallback);
  const shortName = (id: string) =>
    id
      .replace('claude-', '')
      .replace(/-(\d+)-(\d+)$/, ' $1.$2')
      .replace(/^./, (l) => l.toUpperCase());
  return (
    <Section>
      <Muted>{t('instance.modelHelp')}</Muted>
      <Choice
        label={t('instance.model')}
        value={String(value('ai_model', model.value))}
        onChange={(m) => setChanges({ ...changes, ai_model: m })}
        options={data.models.map((m) => ({ value: m.id, label: shortName(m.id) }))}
      />
      {data.models
        .filter((m) => m.id === value('ai_model', model.value))
        .map((m) => (
          <Muted key={m.id}>
            {t('instance.price', { input: money(m.input_usd), output: money(m.output_usd) })}
          </Muted>
        ))}
      <Origin source={'ai_model' in changes ? 'app' : model.source} />
      <Field
        label={t('instance.budget')}
        keyboardType="decimal-pad"
        value={String(value('ai_monthly_budget_usd', budget.value))}
        onChangeText={(v) => setChanges({ ...changes, ai_monthly_budget_usd: v.replace(',', '.') })}
      />
      <HourStepper
        label={t('instance.weeklyHour')}
        utc={Number(value('weekly_report_hour_utc', hour.value))}
        onChange={(u) => setChanges({ ...changes, weekly_report_hour_utc: u })}
      />
      <SaveRow
        dirty={Object.keys(changes).length > 0}
        pending={save.isPending}
        error={save.error?.message}
        onSave={() => save.mutate(changes, { onSuccess: () => setChanges({}) })}
      />
    </Section>
  );
}

const INTERVALS = [0, 15, 30, 60, 180] as const;

/** Settings › Account › Garmin: how often Garmin is asked for new activities. */
export function SyncInterval() {
  const { get, save } = useInstance();
  const interval = get('sync_interval_minutes');
  if (!interval) return null;
  const current = Number(interval.value);
  const options = (INTERVALS as readonly number[]).includes(current) ? INTERVALS : [...INTERVALS, current];
  return (
    <Section>
      <Muted>{t('instance.syncEvery')}</Muted>
      <Choice
        label={t('instance.syncEvery')}
        value={String(current)}
        onChange={(v) => save.mutate({ sync_interval_minutes: Number(v) })}
        options={options.map((m) => ({
          value: String(m),
          label: m === 0 ? t('instance.syncOff') : m < 60 ? `${m} min` : `${m / 60} h`,
        }))}
      />
      <Origin source={interval.source} />
      {save.error && <Muted accessibilityRole="alert">{save.error.message}</Muted>}
    </Section>
  );
}

/** Settings › Notifications: where alerts by e-mail go, and Resend's key to send them. */
export function AlertSettings() {
  const { get, save } = useInstance();
  const email = get('alert_email');
  const [value, setValue] = useState<string | null>(null);
  if (!email) return null;
  const shown = value ?? String(email.value ?? '');
  return (
    <Section>
      <Muted>{t('instance.alertsHelp')}</Muted>
      <Field
        label={t('instance.alertEmail')}
        keyboardType="email-address"
        autoCapitalize="none"
        value={shown}
        onChangeText={setValue}
      />
      <Origin source={email.source} />
      <SaveRow
        dirty={value !== null && value.trim() !== String(email.value ?? '')}
        pending={save.isPending}
        error={save.error?.message}
        onSave={() => save.mutate({ alert_email: shown.trim() || null }, { onSuccess: () => setValue(null) })}
      />
      <Muted>{t('instance.resendHelp')}</Muted>
      <ServiceKeyEditor name="resend" />
    </Section>
  );
}

const S3_FIELDS = ['backup_s3_endpoint', 'backup_s3_bucket', 'backup_s3_region', 'backup_s3_access_key_id'];

/** Settings › Your data: when the daily backup runs, how many are kept and where they go (S3). */
export function BackupSettings() {
  const { get, save } = useInstance();
  const hour = get('backup_hour_utc');
  const keep = get('backup_keep_days');
  const [changes, setChanges] = useState<Changes>({});
  if (!hour || !keep) return null;
  const value = (name: string) =>
    name in changes ? changes[name] : (get(name)?.value as string | number | null | undefined);
  return (
    <Section>
      <Muted>{t('instance.backupHelp')}</Muted>
      <HourStepper
        label={t('instance.backupHour')}
        utc={Number(value('backup_hour_utc'))}
        onChange={(u) => setChanges({ ...changes, backup_hour_utc: u })}
      />
      <Field
        label={t('instance.keepDays')}
        keyboardType="number-pad"
        value={String(value('backup_keep_days') ?? '')}
        onChangeText={(v) => setChanges({ ...changes, backup_keep_days: v })}
      />
      {S3_FIELDS.map((name) => (
        <Field
          key={name}
          label={t(`instance.${name}` as 'instance.backup_s3_bucket')}
          autoCapitalize="none"
          autoCorrect={false}
          value={String(value(name) ?? '')}
          onChangeText={(v) => setChanges({ ...changes, [name]: v.trim() || null })}
        />
      ))}
      <SaveRow
        dirty={Object.keys(changes).length > 0}
        pending={save.isPending}
        error={save.error?.message}
        onSave={() => save.mutate(changes, { onSuccess: () => setChanges({}) })}
      />
      <Muted>{t('instance.s3SecretHelp')}</Muted>
      <ServiceKeyEditor name="backup_s3" />
    </Section>
  );
}

/** Settings › Health: offer connecting Google Health. */
export function GoogleHealthSwitch() {
  const { get, save } = useInstance();
  const enabled = get('google_health_enabled');
  if (!enabled) return null;
  return (
    <SwitchRow
      label={t('instance.googleHealth')}
      value={Boolean(enabled.value)}
      onChange={(on) => save.mutate({ google_health_enabled: on })}
    />
  );
}
