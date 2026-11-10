/**
 * One section of Settings on the phone (OS-522): general (language, units, theme), heart rate and
 * zones, notifications, the AI assistant and MCP tokens, privacy zones, health sources (with Health
 * Connect, OS-607), your data, and security and sessions (biometrics, OS-503; Garmin; devices).
 */
import { meQuery, settingsQuery, THEME_CHOICES, type Locale, type MessageKey } from '@zankup/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useContext, useEffect, useState } from 'react';

import { AiCard } from '../../src/Ai';
import { useAuth } from '../../src/auth';
import { ask, available, lastRead, readAndSend, readHistory, type ReadResult } from '../../src/healthConnect';
import { locale, saveLanguage, t } from '../../src/i18n';
import { SETTINGS_SECTIONS, type SettingsSection } from '../../src/links';
import { Account } from '../../src/profile/Sections';
import { HealthSources } from '../../src/settings/HealthSources';
import { ServiceKeyEditor } from '../../src/settings/ServiceKey';
import { PrivacyZones } from '../../src/settings/Privacy';
import { useSaveSettings } from '../../src/settings/save';
import {
  ExportData,
  Garmin,
  HeartRate,
  Mcp,
  Notifications,
  Sessions,
  Zones,
} from '../../src/settings/Sections';
import { sectionTitle } from '../../src/settings/titles';
import { availableBiometrics, biometricLockOn, instanceUrl, type Biometrics } from '../../src/session';
import { keys, readSync, storage } from '../../src/storage';
import { ThemeContext } from '../../src/theme';
import { Button, Card, Choice, Heading, MenuRow, Muted, Screen, SwitchRow } from '../../src/ui';

export default function SettingsSectionScreen() {
  const params = useLocalSearchParams<{ section: string }>();
  const section = (SETTINGS_SECTIONS as readonly string[]).includes(params.section)
    ? (params.section as SettingsSection)
    : 'general';
  const { api, signOut } = useAuth();
  const me = useQuery({ ...meQuery(api), enabled: section === 'account' });
  return (
    <Screen header>
      <Stack.Screen options={{ title: sectionTitle(section) }} />
      {section === 'general' && <General />}
      {section === 'heart' && (
        <>
          <HeartRate />
          <Zones />
        </>
      )}
      {section === 'notifications' && <Notifications />}
      {section === 'ai' && (
        <>
          <Card>
            <Heading first>{t('keys.anthropic')}</Heading>
            <Muted>{t('keys.anthropicHelp')}</Muted>
            <ServiceKeyEditor name="anthropic" />
          </Card>
          <AiCard />
          <Mcp />
        </>
      )}
      {section === 'privacy' && <PrivacyZones />}
      {section === 'health' && (
        <>
          <HealthHistory />
          <HealthConnectCard />
          <HealthSources />
        </>
      )}
      {section === 'data' && <YourData />}
      {section === 'account' && (
        <>
          {me.data && <Account me={me.data} />}
          <Security />
          <Garmin />
          <Sessions />
          <Button onPress={() => void signOut()}>{t('nav.signOut')}</Button>
        </>
      )}
    </Screen>
  );
}

function General() {
  const { api } = useAuth();
  const theme = useContext(ThemeContext);
  const settings = useQuery(settingsQuery(api));
  const save = useSaveSettings();
  const [language, setLanguage] = useState<Locale | 'auto'>(
    (readSync(keys.language) as Locale | null) ?? 'auto',
  );
  return (
    <Card>
      <Heading>{t('settings.language')}</Heading>
      <Muted>{t('settings.languageHelp')}</Muted>
      <Choice
        label={t('settings.language')}
        value={language}
        onChange={(v) => {
          setLanguage(v);
          const choice = v === 'auto' ? null : v;
          void saveLanguage(choice);
          save.mutate({ language: choice });
        }}
        options={[
          { value: 'auto', label: t('mobile.languageAuto') },
          { value: 'en', label: 'English' },
          { value: 'es', label: 'Español' },
        ]}
      />
      {language !== 'auto' && language !== locale && <Muted>{t('mobile.restartForLanguage')}</Muted>}
      <Heading>{t('settings.units')}</Heading>
      <Choice
        label={t('settings.units')}
        value={settings.data?.units ?? 'metric'}
        onChange={(units) => save.mutate({ units })}
        options={[
          { value: 'metric', label: t('settings.metric') },
          { value: 'imperial', label: t('settings.imperial') },
        ]}
      />
      <Heading>{t('settings.appearance')}</Heading>
      <Muted>{t('settings.themeHelp')}</Muted>
      <Choice
        label={t('settings.appearance')}
        value={theme.choice}
        onChange={theme.setChoice}
        options={THEME_CHOICES.map((choice) => ({ value: choice, label: t(`theme.${choice}`) }))}
      />
    </Card>
  );
}

function YourData() {
  return (
    <>
      <Card style={{ paddingVertical: 0, gap: 0 }}>
        <MenuRow
          label={t('import.title')}
          note={t('data.importNote')}
          onPress={() => router.push('/import')}
        />
        <MenuRow
          label={t('gear.title')}
          note={t('data.gearNote')}
          onPress={() => router.push('/gear')}
          last
        />
      </Card>
      <ExportData />
    </>
  );
}

function Security() {
  const { rekey } = useAuth();
  const [biometrics, setBiometrics] = useState<Biometrics | null>(null);
  const [weak, setWeak] = useState(readSync(keys.weakBiometrics) === '1');
  const [lock, setLock] = useState(biometricLockOn());
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void availableBiometrics().then(setBiometrics);
  }, []);
  // Turning the lock on stores the session behind the fingerprint again (Android asks for it); if that is
  // cancelled, the switch goes back.
  const setLockTo = async (on: boolean) => {
    setLock(on);
    setFailed(false);
    await storage.setItem(keys.biometricLock, on ? '1' : '0');
    try {
      await rekey();
    } catch {
      setLock(!on);
      setFailed(true);
      await storage.setItem(keys.biometricLock, on ? '0' : '1');
    }
  };
  return (
    <Card>
      <Heading>{t('mobile.security')}</Heading>
      {lock || biometrics === 'none' ? (
        <Muted>
          {biometrics === 'strong'
            ? t('mobile.biometricsStrong')
            : biometrics === 'weak'
              ? t('mobile.biometricsWeak')
              : t('mobile.biometricsNone')}
        </Muted>
      ) : null}
      {biometrics !== null && biometrics !== 'none' && (
        <SwitchRow label={t('mobile.biometricLock')} value={lock} onChange={(on) => void setLockTo(on)} />
      )}
      {!lock && <Muted>{t('mobile.biometricLockOff')}</Muted>}
      {failed && <Muted accessibilityRole="alert">{t('common.error')}</Muted>}
      {biometrics === 'weak' && lock && (
        <SwitchRow
          label={t('mobile.weakLock')}
          value={weak}
          onChange={(on) => {
            setWeak(on);
            void storage.setItem(keys.weakBiometrics, on ? '1' : '0').then(rekey);
          }}
        />
      )}
      <Muted>{t('mobile.instanceIs', { url: instanceUrl() ?? '' })}</Muted>
    </Card>
  );
}

/**
 * Each source brought 30 days when it was connected. This asks Garmin and Google Health for the last
 * year (the server does it in the background) and reads it from Health Connect on this phone.
 */
function HealthHistory() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await api.POST('/api/wellness/history');
      const lines: string[] = [];
      const queued = data?.queued ?? [];
      if (queued.length)
        lines.push(
          t('health.history.queued', {
            sources: queued.map((s) => t(`health.source.${s}` as MessageKey)).join(', '),
          }),
        );
      if (lastRead()) {
        const result = await readHistory(api).catch(() => null);
        if (result) lines.push(t('health.history.hc', result));
      }
      setMessage(lines.length ? lines.join(' ') : t('health.history.none'));
      void queryClient.invalidateQueries({ queryKey: ['wellness'] });
    } catch {
      setMessage(t('common.error'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Heading first>{t('health.history.title')}</Heading>
      <Muted>{t('health.history.note')}</Muted>
      <Button disabled={busy} onPress={() => void run()}>
        {busy ? t('health.history.working') : t('health.history.bring')}
      </Button>
      {message && <Muted accessibilityRole="alert">{message}</Muted>}
    </Card>
  );
}

function HealthConnectCard() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const [ready, setReady] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(lastRead());
  useEffect(() => {
    void available().then(setReady);
  }, []);
  const run = async (askFirst: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      if (askFirst && !(await ask())) {
        setMessage(t('mobile.hc.denied'));
        return;
      }
      const result: ReadResult | null = await readAndSend(api, true);
      if (result) {
        setMessage(t('mobile.hc.done', result));
        setLast(lastRead());
        void queryClient.invalidateQueries({ queryKey: ['wellness'] });
      } else setMessage(t('mobile.hc.denied'));
    } catch {
      setMessage(t('common.error'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Heading>{t('mobile.hc.title')}</Heading>
      <Muted>{ready === false ? t('mobile.hc.unavailable') : t('mobile.hc.note')}</Muted>
      {ready && (
        <>
          <Button primary disabled={busy} onPress={() => void run(true)}>
            {t('mobile.hc.connect')}
          </Button>
          {last && (
            <Button disabled={busy} onPress={() => void run(false)}>
              {t('mobile.hc.read')}
            </Button>
          )}
        </>
      )}
      {last && (
        <Muted>
          {t('mobile.hc.last', {
            date: new Date(last).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }),
          })}
        </Muted>
      )}
      {message && <Muted accessibilityRole="alert">{message}</Muted>}
    </Card>
  );
}
