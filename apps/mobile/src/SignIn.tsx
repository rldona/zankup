/**
 * First sign-in on the phone (OS-503): the instance (api.zankup.com or your own), then Google with the
 * native account sheet, or e-mail, password and the authenticator code. After that the fingerprint is
 * enough (session.ts).
 */
import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';
import { createApiClient } from '@zankup/core';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, View } from 'react-native';

import { t } from './i18n';
import {
  checkInstance,
  codeStep,
  DEFAULT_INSTANCE,
  googleStep,
  instanceUrl,
  passwordStep,
  SignInError,
  type Session,
} from './session';
import { Wordmark } from './Wordmark';
import { Button, Field, Muted, Screen } from './ui';

type Step = 'instance' | 'credentials' | 'code';

export function SignIn({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [baseUrl, setBaseUrl] = useState(instanceUrl());
  const [step, setStep] = useState<Step>(baseUrl ? 'credentials' : 'instance');
  const [url, setUrl] = useState(baseUrl ?? DEFAULT_INSTANCE);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState('');
  const [googleClient, setGoogleClient] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!baseUrl) return;
    createApiClient(baseUrl)
      .GET('/api/auth/google/providers')
      .then(({ data }) => setGoogleClient(data?.google ? (data.google_client_id ?? null) : null))
      .catch(() => setGoogleClient(null));
  }, [baseUrl]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof SignInError ? failure.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const google = () =>
    run(async () => {
      if (!baseUrl || !googleClient) return;
      GoogleSignin.configure({ webClientId: googleClient });
      try {
        await GoogleSignin.hasPlayServices();
        const result = await GoogleSignin.signIn();
        if (result.type !== 'success' || !result.data.idToken) return; // closed the sheet
        onSignedIn(await googleStep(baseUrl, result.data.idToken));
      } catch (failure) {
        if (isErrorWithCode(failure) && failure.code === statusCodes.SIGN_IN_CANCELLED) return;
        throw failure instanceof SignInError ? failure : new SignInError(t('mobile.googleFailed'));
      } finally {
        await GoogleSignin.signOut().catch(() => undefined); // pick the account again next time
      }
    });

  return (
    <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
      <Screen>
        <View style={{ gap: 16, paddingTop: 32 }}>
          <Wordmark />
          {step === 'instance' && (
            <>
              <Muted>{t('mobile.instanceHelp')}</Muted>
              <Field
                label={t('mobile.instance')}
                value={url}
                onChangeText={setUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <Button
                primary
                disabled={busy || !url.trim()}
                onPress={() =>
                  void run(async () => {
                    setBaseUrl(await checkInstance(url));
                    setStep('credentials');
                  })
                }
              >
                {t('mobile.continue')}
              </Button>
            </>
          )}
          {step === 'credentials' && baseUrl && (
            <>
              <Muted>{baseUrl.replace(/^https?:\/\//, '')}</Muted>
              {googleClient && (
                <>
                  <Button primary disabled={busy} onPress={() => void google()}>
                    {t('signIn.google')}
                  </Button>
                  <Muted style={{ textAlign: 'center' }}>{t('signIn.or')}</Muted>
                </>
              )}
              <Field
                label={t('signIn.email')}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="username"
              />
              <Field
                label={t('signIn.password')}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
              />
              <Button
                primary={!googleClient}
                disabled={busy || !email || !password}
                onPress={() =>
                  void run(async () => {
                    setChallenge(await passwordStep(baseUrl, email.trim(), password));
                    setStep('code');
                  })
                }
              >
                {t('signIn.submit')}
              </Button>
              <Button onPress={() => setStep('instance')}>{t('mobile.changeInstance')}</Button>
            </>
          )}
          {step === 'code' && baseUrl && (
            <>
              <Muted>{t('signIn.codeSub')}</Muted>
              <Field
                label={t('signIn.codeTitle')}
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={16}
              />
              <Button
                primary
                disabled={busy || code.length < 6}
                onPress={() =>
                  void run(async () => onSignedIn(await codeStep(baseUrl, challenge, code.trim())))
                }
              >
                {t('signIn.verify')}
              </Button>
            </>
          )}
          {error && (
            <Muted style={{ color: '#e5484d' }} accessibilityRole="alert">
              {error}
            </Muted>
          )}
          {step !== 'instance' && <Muted>{t('mobile.fingerprintNote')}</Muted>}
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
