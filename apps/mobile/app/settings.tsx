/**
 * Settings on the phone: language, theme and units (shared with the account), notifications on this
 * phone (OS-507), Health Connect (OS-607), the biometric option for phones whose face unlock is weak
 * (OS-503), the AI assistant's switches (OS-708) and sign-out.
 */
import { settingsQuery, THEME_CHOICES, type Locale } from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useContext, useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { AiCard } from '../src/Ai';
import { useAuth } from '../src/auth';
import { ask, available, lastRead, readAndSend, type ReadResult } from '../src/healthConnect';
import { locale, saveLanguage, t } from '../src/i18n';
import { registerPush, unregisterPush, type PushResult } from '../src/push';
import { availableBiometrics, instanceUrl, type Biometrics } from '../src/session';
import { keys, readSync, storage } from '../src/storage';
import { ThemeContext, useTheme } from '../src/theme';
import { Button, Card, Choice, Heading, Muted, Screen } from '../src/ui';

export default function SettingsScreen() {
  const { api, signOut, rekey } = useAuth();
  const c = useTheme();
  const theme = useContext(ThemeContext);
  const queryClient = useQueryClient();
  const settings = useQuery(settingsQuery(api));
  const [language, setLanguage] = useState<Locale | 'auto'>(
    (readSync(keys.language) as Locale | null) ?? 'auto',
  );
  const [push, setPush] = useState<PushResult | 'off' | null>(null);
  const [biometrics, setBiometrics] = useState<Biometrics | null>(null);
  const [weak, setWeak] = useState(readSync(keys.weakBiometrics) === '1');
  useEffect(() => {
    void availableBiometrics().then(setBiometrics);
  }, []);
  const save = useMutation({
    mutationFn: async (body: { units?: 'metric' | 'imperial'; language?: Locale | null }) => {
      const { data } = await api.PATCH('/api/settings', { body });
      if (data) queryClient.setQueryData(settingsQuery(api).queryKey, data);
    },
  });
  return (
    <Screen header>
      <Card>
        <Heading>{t('settings.language')}</Heading>
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
        {(language === 'auto' ? null : language) !== locale && language !== 'auto' && (
          <Muted>{t('mobile.restartForLanguage')}</Muted>
        )}
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
        <Choice
          label={t('settings.appearance')}
          value={theme.choice}
          onChange={theme.setChoice}
          options={THEME_CHOICES.map((choice) => ({ value: choice, label: t(`theme.${choice}`) }))}
        />
      </Card>

      <Card>
        <Heading>{t('notifications.title')}</Heading>
        <Muted>{t('mobile.pushHelp')}</Muted>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button primary onPress={() => void registerPush(api).then(setPush)}>
            {t('mobile.pushOn')}
          </Button>
          <Button onPress={() => void unregisterPush(api).then(() => setPush('off'))}>
            {t('mobile.pushOff')}
          </Button>
        </View>
        {push && <Muted>{t(`mobile.push.${push}`)}</Muted>}
      </Card>

      <HealthConnectCard />

      <AiCard />

      <Card>
        <Heading>{t('mobile.security')}</Heading>
        <Muted>
          {biometrics === 'strong'
            ? t('mobile.biometricsStrong')
            : biometrics === 'weak'
              ? t('mobile.biometricsWeak')
              : t('mobile.biometricsNone')}
        </Muted>
        {biometrics === 'weak' && (
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
          >
            <Text style={{ color: c.fg, flex: 1 }}>{t('mobile.weakLock')}</Text>
            <Switch
              accessibilityLabel={t('mobile.weakLock')}
              value={weak}
              onValueChange={(on) => {
                setWeak(on);
                void storage.setItem(keys.weakBiometrics, on ? '1' : '0').then(rekey);
              }}
            />
          </View>
        )}
        <Muted>{t('mobile.instanceIs', { url: instanceUrl() ?? '' })}</Muted>
      </Card>

      <Button onPress={() => void signOut()}>{t('nav.signOut')}</Button>
    </Screen>
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
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button primary disabled={busy} onPress={() => void run(true)}>
            {t('mobile.hc.connect')}
          </Button>
          {last && (
            <Button disabled={busy} onPress={() => void run(false)}>
              {t('mobile.hc.read')}
            </Button>
          )}
        </View>
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
