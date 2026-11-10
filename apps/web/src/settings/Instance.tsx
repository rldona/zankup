import { instanceQuery, queryKeys, type InstanceSettings } from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { api } from '../api';
import { t } from '../i18n';
import { ServiceKeyForm } from './ServiceKey';

type Changes = Record<string, unknown>;

/** The browser's offset from UTC in hours; hours are shown in local time and kept in UTC. */
const offsetHours = () => -new Date().getTimezoneOffset() / 60;
const toLocal = (utc: number) => (((utc + offsetHours()) % 24) + 24) % 24;
const toUtc = (local: number) => (((local - offsetHours()) % 24) + 24) % 24;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

function useInstance() {
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
    },
  });
  const get = (name: string) => query.data?.settings.find((s) => s.name === name);
  return { data: query.data, get, save };
}

function Origin({ source }: { source?: string }) {
  return source === 'env' ? <p className="note">{t('instance.fromServer')}</p> : null;
}

function HourSelect({ value, onChange }: { value: number; onChange: (utc: number) => void }) {
  return (
    <select value={toLocal(value)} onChange={(e) => onChange(toUtc(Number(e.target.value)))}>
      {HOURS.map((h) => (
        <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>
      ))}
    </select>
  );
}

function Form({
  changes,
  save,
  reset,
  children,
}: {
  changes: Changes;
  save: ReturnType<typeof useInstance>['save'];
  reset: () => void;
  children: React.ReactNode;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(changes, { onSuccess: reset });
  };
  return (
    <form onSubmit={submit}>
      <div className="fields">{children}</div>
      <p className="actions">
        <button type="submit" className="primary" disabled={!Object.keys(changes).length || save.isPending}>
          {t('settings.save')}
        </button>
      </p>
      {save.isError && (
        <p className="note" role="alert">
          {save.error.message}
        </p>
      )}
    </form>
  );
}

/** Zankup Coach: the model (with its price), the monthly budget and Monday's hour. */
export function CoachSettings() {
  const { data, get, save } = useInstance();
  const [changes, setChanges] = useState<Changes>({});
  const model = get('ai_model');
  const budget = get('ai_monthly_budget_usd');
  const hour = get('weekly_report_hour_utc');
  if (!data || !model || !budget || !hour) return null;
  const value = (name: string, fallback: unknown) => (name in changes ? changes[name] : fallback);
  const chosen = data.models.find((m) => m.id === value('ai_model', model.value));
  return (
    <div className="panel">
      <h3>{t('instance.coachTitle')}</h3>
      <p className="note">{t('instance.modelHelp')}</p>
      <Form changes={changes} save={save} reset={() => setChanges({})}>
        <label className="field">
          <span>
            <b>{t('instance.model')}</b>
            {chosen && (
              <small className="note">
                {t('instance.price', {
                  input: chosen.input_usd.toFixed(2),
                  output: chosen.output_usd.toFixed(2),
                })}
              </small>
            )}
          </span>
          <select
            value={String(value('ai_model', model.value))}
            onChange={(e) => setChanges({ ...changes, ai_model: e.target.value })}
          >
            {data.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>
            <b>{t('instance.budget')}</b>
          </span>
          <input
            type="number"
            min="0.5"
            step="0.5"
            value={String(value('ai_monthly_budget_usd', budget.value))}
            onChange={(e) => setChanges({ ...changes, ai_monthly_budget_usd: e.target.value })}
          />
        </label>
        <label className="field">
          <span>
            <b>{t('instance.weeklyHour')}</b>
          </span>
          <HourSelect
            value={Number(value('weekly_report_hour_utc', hour.value))}
            onChange={(u) => setChanges({ ...changes, weekly_report_hour_utc: u })}
          />
        </label>
      </Form>
      <Origin source={model.source} />
    </div>
  );
}

/** Garmin: how often it is asked for new activities. */
export function SyncInterval() {
  const { get, save } = useInstance();
  const interval = get('sync_interval_minutes');
  if (!interval) return null;
  return (
    <label className="field">
      <span>
        <b>{t('instance.syncEvery')}</b>
      </span>
      <select
        value={String(interval.value)}
        onChange={(e) => save.mutate({ sync_interval_minutes: Number(e.target.value) })}
      >
        {[...new Set([0, 15, 30, 60, 180, Number(interval.value)])].map((m) => (
          <option key={m} value={m}>
            {m === 0 ? t('instance.syncOff') : m < 60 ? `${m} min` : `${m / 60} h`}
          </option>
        ))}
      </select>
    </label>
  );
}

/** E-mail alerts: where they go, and Resend's key to send them. */
export function AlertSettings() {
  const { get, save } = useInstance();
  const [changes, setChanges] = useState<Changes>({});
  const email = get('alert_email');
  if (!email) return null;
  return (
    <>
      <h2>{t('instance.alertsTitle')}</h2>
      <div className="panel">
        <p className="note">{t('instance.alertsHelp')}</p>
        <Form changes={changes} save={save} reset={() => setChanges({})}>
          <label className="field">
            <span>
              <b>{t('instance.alertEmail')}</b>
            </span>
            <input
              type="email"
              value={String('alert_email' in changes ? (changes.alert_email ?? '') : (email.value ?? ''))}
              onChange={(e) => setChanges({ alert_email: e.target.value.trim() || null })}
            />
          </label>
        </Form>
        <Origin source={email.source} />
        <p className="note">{t('instance.resendHelp')}</p>
        <ServiceKeyForm name="resend" />
      </div>
    </>
  );
}

const S3_FIELDS = ['backup_s3_endpoint', 'backup_s3_bucket', 'backup_s3_region', 'backup_s3_access_key_id'];

/** Backups: when the daily one runs, how many are kept and where they go (S3). */
export function BackupSettings() {
  const { get, save } = useInstance();
  const [changes, setChanges] = useState<Changes>({});
  const hour = get('backup_hour_utc');
  const keep = get('backup_keep_days');
  if (!hour || !keep) return null;
  const value = (name: string) => (name in changes ? changes[name] : get(name)?.value);
  return (
    <>
      <h2>{t('instance.backupTitle')}</h2>
      <div className="panel">
        <p className="note">{t('instance.backupHelp')}</p>
        <Form changes={changes} save={save} reset={() => setChanges({})}>
          <label className="field">
            <span>
              <b>{t('instance.backupHour')}</b>
            </span>
            <HourSelect
              value={Number(value('backup_hour_utc'))}
              onChange={(u) => setChanges({ ...changes, backup_hour_utc: u })}
            />
          </label>
          <label className="field">
            <span>
              <b>{t('instance.keepDays')}</b>
            </span>
            <input
              type="number"
              min="1"
              value={String(value('backup_keep_days') ?? '')}
              onChange={(e) => setChanges({ ...changes, backup_keep_days: e.target.value })}
            />
          </label>
          {S3_FIELDS.map((name) => (
            <label key={name} className="field">
              <span>
                <b>{t(`instance.${name}` as 'instance.backup_s3_bucket')}</b>
              </span>
              <input
                spellCheck={false}
                value={String(value(name) ?? '')}
                onChange={(e) => setChanges({ ...changes, [name]: e.target.value.trim() || null })}
              />
            </label>
          ))}
        </Form>
        <p className="note">{t('instance.s3SecretHelp')}</p>
        <ServiceKeyForm name="backup_s3" />
      </div>
    </>
  );
}

/** Health: offer connecting Google Health. */
export function GoogleHealthSwitch() {
  const { get, save } = useInstance();
  const enabled = get('google_health_enabled');
  if (!enabled) return null;
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={Boolean(enabled.value)}
        onChange={(e) => save.mutate({ google_health_enabled: e.target.checked })}
      />
      {t('instance.googleHealth')}
    </label>
  );
}
