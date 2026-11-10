/**
 * The app's frame: theme, the persisted query cache (OS-505) and the session (OS-503). Opening the app
 * asks for the fingerprint; without a session it shows sign-in. Signed in, it registers notifications
 * (OS-507), the background sync (OS-506), refreshes the widget (OS-509) and reads Health Connect (OS-607).
 */
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import type { ThemeChoice } from '@zankup/core';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthContext } from '../src/auth';
import { scheduleBackgroundSync } from '../src/background';
import { t } from '../src/i18n';
import { forgetOfflineData, keepOffline, OFFLINE_MAX_AGE, persister, queryClient } from '../src/offline';
import { readAndSend as readHealthConnect } from '../src/healthConnect';
import { listenToTaps, registerPush } from '../src/push';
import { authorisedClient, signOut, storeRefreshToken, unlock, type Session } from '../src/session';
import { OfflineNotice } from '../src/OfflineNotice';
import { Wordmark } from '../src/Wordmark';
import { SignIn } from '../src/SignIn';
import { keys, storage } from '../src/storage';
import { palette, savedTheme, ThemeContext } from '../src/theme';
import { Button, Muted } from '../src/ui';
import { refreshWidget } from '../src/widget/handler';

void SplashScreen.preventAutoHideAsync();

type State =
  { kind: 'starting' } | { kind: 'signed-out' } | { kind: 'locked' } | { kind: 'in'; session: Session };

export default function Root() {
  const [choice, setChoiceState] = useState<ThemeChoice>(savedTheme);
  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    void storage.setItem(keys.theme, next);
  }, []);
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const c = palette(choice, scheme);
  const [state, setState] = useState<State>({ kind: 'starting' });

  const open = useCallback(async () => {
    try {
      const result = await unlock();
      if ('session' in result) setState({ kind: 'in', session: result.session });
      else if ('cancelled' in result) setState({ kind: 'locked' });
      else setState({ kind: 'signed-out' });
    } catch {
      setState({ kind: 'locked' }); // the keystore failed for another reason: let the person retry
    } finally {
      void SplashScreen.hideAsync();
    }
  }, []);

  useEffect(() => {
    // The state changes only after the fingerprint and the network answer, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void open();
  }, [open]);

  const session = state.kind === 'in' ? state.session : null;
  const api = useMemo(
    () => (session ? authorisedClient(session, () => setState({ kind: 'signed-out' })) : null),
    [session],
  );

  useEffect(() => {
    if (!api || !session?.accessToken) return;
    void registerPush(api);
    void scheduleBackgroundSync();
    void refreshWidget(api).catch(() => undefined);
    void readHealthConnect(api).catch(() => undefined); // only once allowed, at most hourly (OS-607)
    return listenToTaps();
  }, [api, session?.accessToken]);

  const auth = useMemo(
    () =>
      api
        ? {
            api,
            rekey: async () => {
              if (session?.refreshToken) await storeRefreshToken(session.refreshToken);
            },
            signOut: async () => {
              await signOut(api);
              await forgetOfflineData();
              setState({ kind: 'signed-out' });
            },
          }
        : null,
    [api, session],
  );

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.bg }}>
      <SafeAreaProvider>
        <ThemeContext.Provider value={{ choice, setChoice }}>
          <PersistQueryClientProvider
            client={queryClient}
            persistOptions={{
              persister,
              maxAge: OFFLINE_MAX_AGE,
              dehydrateOptions: { shouldDehydrateQuery: keepOffline },
            }}
          >
            <StatusBar style={c.scheme === 'dark' ? 'light' : 'dark'} />
            {state.kind === 'starting' ? (
              <View style={{ flex: 1, backgroundColor: c.bg }} />
            ) : state.kind === 'signed-out' ? (
              <SignIn onSignedIn={(s) => setState({ kind: 'in', session: s })} />
            ) : state.kind === 'locked' ? (
              <View
                style={{ flex: 1, backgroundColor: c.bg, padding: 24, justifyContent: 'center', gap: 16 }}
              >
                <Wordmark />
                <Muted>{t('mobile.locked')}</Muted>
                <Button primary onPress={() => void open()}>
                  {t('mobile.unlock')}
                </Button>
              </View>
            ) : (
              <AuthContext.Provider value={auth}>
                <Stack
                  screenOptions={{
                    headerStyle: { backgroundColor: c.bg },
                    headerTintColor: c.fg,
                    contentStyle: { backgroundColor: c.bg },
                    headerShadowVisible: false,
                  }}
                >
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  <Stack.Screen name="activity/[id]" options={{ title: '' }} />
                  <Stack.Screen name="settings/index" options={{ title: t('nav.settings') }} />
                  <Stack.Screen name="settings/[section]" options={{ title: '' }} />
                  <Stack.Screen name="stats" options={{ title: t('nav.stats') }} />
                  <Stack.Screen name="estimates" options={{ title: t('stats.estimates') }} />
                  <Stack.Screen name="sync" options={{ title: t('sync.title') }} />
                  <Stack.Screen name="notifications" options={{ title: t('notifications.title') }} />
                  <Stack.Screen name="coach" options={{ title: t('coach.title') }} />
                  <Stack.Screen name="gear" options={{ title: t('gear.title') }} />
                  <Stack.Screen name="import" options={{ title: t('import.title') }} />
                  <Stack.Screen name="calendar" options={{ title: t('calendar.title') }} />
                  <Stack.Screen name="heatmap" options={{ title: t('heatmap.title') }} />
                  <Stack.Screen name="routes/index" options={{ title: t('routes.title') }} />
                  <Stack.Screen name="routes/[id]" options={{ title: '' }} />
                  <Stack.Screen name="segments/index" options={{ title: t('segments.title') }} />
                  <Stack.Screen name="segments/[id]" options={{ title: '' }} />
                  <Stack.Screen name="review/[period]" options={{ title: '' }} />
                </Stack>
                <OfflineNotice />
              </AuthContext.Provider>
            )}
          </PersistQueryClientProvider>
        </ThemeContext.Provider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
