import {
  devicesQuery,
  engineQuery,
  estimatesQuery,
  meQuery,
  settingsQuery,
  sourcesQuery,
  THEME_CHOICES,
  themes,
  type Locale,
  type MaterialIcon as MaterialIconName,
  type MessageKey,
  type ThemeChoice,
} from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type CSSProperties, type FormEvent } from 'react';

import { Link, Navigate, NavLink, useLocation, useParams } from 'react-router';

import { api } from '../api';
import { chosenLanguage, locale, switchLanguage, t } from '../i18n';
import { Ai } from '../settings/Ai';
import { HealthHistory, HealthSources } from '../settings/Health';
import { Mcp } from '../settings/Mcp';
import { Notifications } from '../settings/Notifications';
import { PrivacyZones } from '../settings/Privacy';
import { ExportData } from './Library';
import { useSaveSettings } from '../settings';
import { useSetTheme, useThemeChoice } from '../theme';
import { AlertSettings, BackupSettings, GoogleHealthSwitch, SyncInterval } from '../settings/Instance';
import { ServiceKeyForm } from '../settings/ServiceKey';
import { MaterialIcon } from '../MaterialIcon';
import { Account } from './Profile';

// The "System" preview is half light, half dark: the two themes the device can pick between.
const SPLIT = { '--light-bg': themes.light.bg, '--dark-bg': themes.dark.bg } as CSSProperties;

const NOTES: Partial<Record<ThemeChoice, MessageKey>> = {
  system: 'theme.systemNote',
  oled: 'theme.oledNote',
  highContrast: 'theme.highContrastNote',
};

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

const SECTIONS = ['general', 'heart', 'notifications', 'ai', 'privacy', 'health', 'data', 'account'] as const;
type Section = (typeof SECTIONS)[number];

const ICONS: Record<Section, MaterialIconName> = {
  general: 'tune',
  heart: 'ecg_heart',
  notifications: 'notifications',
  ai: 'wand_stars',
  privacy: 'location_off',
  health: 'health_and_safety',
  data: 'database',
  account: 'lock',
};

const TITLES: Record<Section, MessageKey> = {
  general: 'mobile.section.general',
  heart: 'mobile.section.heart',
  notifications: 'notifications.title',
  ai: 'mobile.section.ai',
  privacy: 'privacy.title',
  health: 'health.settings',
  data: 'data.title',
  account: 'mobile.section.account',
};

const SECTION_NOTES: Record<Section, MessageKey> = {
  general: 'mobile.section.generalNote',
  heart: 'mobile.section.heartNote',
  // Where notifications arrive on the web: this browser, not the phone (docs/prototypes/web).
  notifications: 'settings.section.notificationsNoteWeb',
  ai: 'mobile.section.aiNote',
  privacy: 'mobile.section.privacyNote',
  health: 'mobile.section.healthNote',
  data: 'mobile.section.dataNote',
  account: 'mobile.section.accountNote',
};

/** Old links went to an anchor on the one long page (`/settings#health`): the section it was in. */
const ANCHORS: Record<string, Section> = {
  health: 'health',
  ai: 'ai',
  mcp: 'ai',
  notifications: 'notifications',
  privacy: 'privacy',
  garmin: 'account',
  sessions: 'account',
  zones: 'heart',
};

/**
 * Settings (OS-212, OS-214, OS-914), in the app's sections: general, heart rate and zones,
 * notifications, AI, privacy, health, your data and the account, each on its own page. On a large
 * screen the list stays on the left and the open section on the right (General when none is open); on
 * a phone the list is one page and each section another.
 */
export function Settings() {
  const { section: param } = useParams();
  const { hash, search } = useLocation();
  // Google Health's sign-in comes back to `/settings?health=connected`.
  const anchor = ANCHORS[hash.slice(1)] ?? (new URLSearchParams(search).has('health') ? 'health' : undefined);
  if (!param && anchor) return <Navigate to={`/settings/${anchor}${search}`} replace />;
  const section = (SECTIONS as readonly string[]).includes(param ?? '') ? (param as Section) : null;
  if (param && !section) return <Navigate to="/settings" replace />;
  const shown = section ?? 'general';
  return (
    <section className={`page settings${section ? ' picked' : ''}`}>
      <h1 className="settingstitle">{t('nav.settings')}</h1>
      <div className="settingswrap">
        <nav className="panel menu settingslist" aria-label={t('nav.settings')}>
          {SECTIONS.map((s) => (
            <NavLink key={s} to={`/settings/${s}`} className={s === shown ? 'on' : undefined}>
              <MaterialIcon name={ICONS[s]} />
              <span>
                <b>{t(TITLES[s])}</b>
                <small>{t(SECTION_NOTES[s])}</small>
              </span>
              <i aria-hidden="true">›</i>
            </NavLink>
          ))}
        </nav>
        <div className="settingsmain">
          <h2 className="sectiontitle">{t(TITLES[shown])}</h2>
          <SectionBody section={shown} />
        </div>
      </div>
    </section>
  );
}

function SectionBody({ section }: { section: Section }) {
  const me = useQuery(meQuery(api));
  switch (section) {
    case 'general':
      return (
        <>
          <Appearance />
          <LanguageAndUnits />
        </>
      );
    case 'heart':
      return (
        <>
          <HeartRate />
          <Zones />
        </>
      );
    case 'notifications':
      return (
        <>
          <Notifications />
          <AlertSettings />
        </>
      );
    case 'ai':
      return (
        <>
          <Ai />
          <Mcp />
        </>
      );
    case 'privacy':
      return <PrivacyZones />;
    case 'health':
      return (
        <>
          <HealthHistory />
          <GoogleHealthSwitch />
          <HealthSources />
        </>
      );
    case 'data':
      return (
        <>
          <YourData />
          <BackupSettings />
        </>
      );
    case 'account':
      return (
        <>
          {me.data && <Account me={me.data} />}
          <Garmin />
          <Sessions />
        </>
      );
  }
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

function YourData() {
  return (
    <>
      <h2>{t('data.title')}</h2>
      <ul className="rows links">
        <li>
          <span>
            <Link to="/settings/import">{t('import.title')}</Link>
            <small className="note">{t('data.importNote')}</small>
          </span>
        </li>
        <li>
          <span>
            <Link to="/gear">{t('gear.title')}</Link>
            <small className="note">{t('data.gearNote')}</small>
          </span>
        </li>
      </ul>
      <ExportData />
    </>
  );
}

function Garmin() {
  const sources = useQuery(sourcesQuery(api));
  const garmin = sources.data?.find((s) => s.kind === 'garmin');
  if (!garmin) return null;
  return (
    <>
      <h2>{t('settings.garmin')}</h2>
      <div className="panel stack">
        {garmin.expiring_soon && garmin.key_expires_on && (
          <p className="warn" role="alert">
            {t('settings.garminSoon', { date: day(garmin.key_expires_on) })}
          </p>
        )}
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
        <SyncInterval />
        <p className="note">{t('keys.garminHelp')}</p>
        <ServiceKeyForm name="garmin" />
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
