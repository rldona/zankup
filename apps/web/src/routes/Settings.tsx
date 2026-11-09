import {
  devicesQuery,
  engineQuery,
  estimatesQuery,
  settingsQuery,
  sourcesQuery,
  THEME_CHOICES,
  themes,
  type Locale,
  type MessageKey,
  type ThemeChoice,
} from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type CSSProperties, type FormEvent } from 'react';

import { api } from '../api';
import { chosenLanguage, locale, switchLanguage, t } from '../i18n';
import { useSaveSettings } from '../settings';
import { useSetTheme, useThemeChoice } from '../theme';

// The "System" preview is half light, half dark: the two themes the device can pick between.
const SPLIT = { '--light-bg': themes.light.bg, '--dark-bg': themes.dark.bg } as CSSProperties;

const NOTES: Partial<Record<ThemeChoice, MessageKey>> = {
  system: 'theme.systemNote',
  oled: 'theme.oledNote',
  highContrast: 'theme.highContrastNote',
};

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

/** Settings (OS-212 and OS-214): appearance, language and units, heart rate, Garmin and sessions. */
export function Settings() {
  return (
    <section className="page">
      <h1>{t('nav.settings')}</h1>
      <Appearance />
      <LanguageAndUnits />
      <HeartRate />
      <Zones />
      <Garmin />
      <Sessions />
    </section>
  );
}

function Appearance() {
  const current = useThemeChoice();
  const setTheme = useSetTheme();
  return (
    <>
      <h2>{t('settings.appearance')}</h2>
      <p className="note">{t('settings.themeHelp')}</p>
      <div className="themes">
        {THEME_CHOICES.map((choice) => {
          const note = NOTES[choice];
          return (
            <button
              key={choice}
              type="button"
              className="theme"
              aria-pressed={current === choice}
              onClick={() => setTheme(choice)}
            >
              {/* Each preview carries its own data-theme, so it is drawn with that theme's variables. */}
              <span
                className="tprev"
                aria-hidden="true"
                data-theme={choice === 'system' ? undefined : choice}
                style={choice === 'system' ? SPLIT : undefined}
              >
                <i className="tbar" />
                <i className="tcard">
                  <b />
                  <b />
                </i>
                <i className="tdot" />
              </span>
              <span className="tname">{t(`theme.${choice}`)}</span>
              {note && <span className="note">{t(note)}</span>}
            </button>
          );
        })}
      </div>
    </>
  );
}

function LanguageAndUnits() {
  const settings = useQuery(settingsQuery(api));
  const save = useSaveSettings();
  const language = chosenLanguage() ?? '';
  return (
    <>
      <h2>
        {t('settings.language')} · {t('settings.units')}
      </h2>
      <div className="fields">
        <label className="field">
          <span>
            <b>{t('settings.language')}</b>
            <small className="note">{t('settings.languageHelp')}</small>
          </span>
          <select
            value={language}
            onChange={(e) => {
              const choice = (e.target.value || null) as Locale | null;
              save.mutate({ language: choice }, { onSettled: () => switchLanguage(choice) });
            }}
          >
            <option value="">{t('settings.languageAuto')}</option>
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </label>
        <label className="field">
          <span>
            <b>{t('settings.units')}</b>
          </span>
          <select
            value={settings.data?.units ?? 'metric'}
            onChange={(e) => save.mutate({ units: e.target.value as 'metric' | 'imperial' })}
          >
            <option value="metric">{t('settings.metric')}</option>
            <option value="imperial">{t('settings.imperial')}</option>
          </select>
        </label>
      </div>
    </>
  );
}

function HeartRate() {
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
  const number = (v: string) => (v.trim() ? Number(v) : null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({ hr_max: number(max), hr_rest: number(rest) });
  };
  return (
    <form onSubmit={submit}>
      <h2>{t('settings.heart')}</h2>
      <p className="note">{estimate ? t('settings.hrHelp', { estimate }) : t('settings.hrHelpNone')}</p>
      <div className="fields">
        <label className="field">
          <span>
            <b>{t('settings.hrMax')}</b>
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={100}
            max={240}
            placeholder={estimate?.toString() ?? ''}
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />
        </label>
        <label className="field">
          <span>
            <b>{t('settings.hrRest')}</b>
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={25}
            max={120}
            value={rest}
            onChange={(e) => setRest(e.target.value)}
          />
        </label>
      </div>
      <div className="actions">
        <button type="submit" disabled={save.isPending}>
          {t('settings.save')}
        </button>
        {save.isSuccess && <span className="note">{t('settings.saved')}</span>}
        {save.isError && (
          <span className="note" role="alert">
            {t('common.error')}
          </span>
        )}
      </div>
    </form>
  );
}

function Garmin() {
  const sources = useQuery(sourcesQuery(api));
  const garmin = sources.data?.find((s) => s.kind === 'garmin');
  if (!garmin) return null;
  return (
    <>
      <h2>{t('settings.garmin')}</h2>
      <div className="panel">
        <p className={garmin.configured ? 'ok' : 'warn'}>
          {garmin.configured ? t('settings.garminOn') : t('settings.garminOff')}
          {garmin.key_expires_on &&
            ` ${t(garmin.expiring_soon ? 'settings.garminSoon' : 'settings.garminExpires', { date: day(garmin.key_expires_on) })}`}
        </p>
        <p className="note">
          {garmin.last_sync_at
            ? t('settings.lastSync', {
                date: new Date(garmin.last_sync_at).toLocaleString(locale, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              })
            : t('settings.never')}
          {garmin.last_error && ` ${t('settings.lastError', { error: garmin.last_error })}`}
        </p>
      </div>
    </>
  );
}

function Sessions() {
  const devices = useQuery(devicesQuery(api));
  const queryClient = useQueryClient();
  const close = useMutation({
    mutationFn: async (id: number) => {
      await api.DELETE('/api/auth/devices/{device_id}', { params: { path: { device_id: id } } });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: devicesQuery(api).queryKey }),
  });
  return (
    <>
      <h2>{t('settings.sessions')}</h2>
      <ul className="rows">
        {devices.data?.map((d) => (
          <li key={d.id}>
            <span>
              <b>{d.name}</b>
              <small className="note">
                {t(d.platform === 'android' ? 'settings.platform.android' : 'settings.platform.web')}
                {d.last_seen && ` · ${t('settings.lastSeen', { date: day(d.last_seen) })}`}
              </small>
            </span>
            {d.current ? (
              <span className="badge">{t('settings.thisDevice')}</span>
            ) : (
              <button type="button" onClick={() => close.mutate(d.id)} disabled={close.isPending}>
                {t('settings.signOutDevice')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Zone model, threshold HR and FTP (OS-301): changing them recomputes everything in the background. */
function Zones() {
  const settings = useQuery(settingsQuery(api));
  const estimates = useQuery(estimatesQuery(api));
  const engine = useQuery({
    ...engineQuery(api),
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });
  const save = useSaveSettings();
  const queryClient = useQueryClient();
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
  const number = (v: string) => (v.trim() ? Number(v) : null);
  return (
    <>
      <h2>{t('settings.zones')}</h2>
      <p className="note">{t('settings.recomputeNote')}</p>
      <div className="fields">
        <label className="field">
          <b>{t('settings.zoneModel')}</b>
          <select
            value={settings.data.zone_model}
            onChange={(e) => save.mutate({ zone_model: e.target.value as 'max' | 'reserve' | 'lthr' })}
          >
            <option value="max">{t('settings.zone.max')}</option>
            <option value="reserve">{t('settings.zone.reserve')}</option>
            <option value="lthr">{t('settings.zone.lthr')}</option>
          </select>
        </label>
        <label className="field">
          <b>{t('settings.lthr')}</b>
          <input
            key={`lthr-${settings.data.lthr}`}
            type="number"
            inputMode="numeric"
            min={80}
            max={220}
            defaultValue={settings.data.lthr ?? ''}
            placeholder={lthr ? String(Math.round(lthr)) : ''}
            onBlur={(e) => {
              const v = number(e.target.value);
              if (v !== settings.data.lthr) save.mutate({ lthr: v });
            }}
          />
          {lthr && (
            <small className="note">{t('settings.estimated', { value: `${Math.round(lthr)} bpm` })}</small>
          )}
        </label>
        <label className="field">
          <b>{t('settings.ftp')}</b>
          <input
            key={`ftp-${settings.data.ftp}`}
            type="number"
            inputMode="numeric"
            min={30}
            max={600}
            defaultValue={settings.data.ftp ?? ''}
            placeholder={ftp ? String(Math.round(ftp)) : ''}
            onBlur={(e) => {
              const v = number(e.target.value);
              if (v !== settings.data.ftp) save.mutate({ ftp: v });
            }}
          />
          {ftp && (
            <small className="note">{t('settings.estimated', { value: `${Math.round(ftp)} W` })}</small>
          )}
        </label>
      </div>
      <div className="actions">
        <button
          type="button"
          onClick={() => recompute.mutate()}
          disabled={recompute.isPending || engine.data?.running}
        >
          {t('settings.recompute')}
        </button>
        {engine.data?.running && (
          <span className="note" role="status">
            {t('stats.recomputing', { done: engine.data.done, total: engine.data.total })}
          </span>
        )}
      </div>
    </>
  );
}
