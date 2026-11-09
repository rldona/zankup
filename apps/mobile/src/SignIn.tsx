/**
 * Signing in on the phone (OS-503, OS-524 to OS-526), as in the PWA: the instance (api.zankup.com or
 * your own), then e-mail and password followed by the code, a passkey, or Google with the native
 * account sheet; "forgot it?"; and on a brand-new instance, creating its account. After that the
 * fingerprint is enough (session.ts).
 */
import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';
import { createApiClient } from '@zankup/core';
import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Pressable, Text, View } from 'react-native';

import { Icon } from './Icon';
import { t } from './i18n';
import {
  checkInstance,
  codeStep,
  DEFAULT_INSTANCE,
  forgotPassword,
  googleStep,
  instanceUrl,
  passkeyStep,
  passkeysSupported,
  passwordStep,
  setupOpen,
  SignInError,
  type Session,
} from './session';
import { CodeBoxes, ErrorBox, PasswordField } from './signin/Fields';
import { Setup } from './signin/Setup';
import { challengeExpired, validEmail } from './signin/rules';
import { useTheme } from './theme';
import { Wordmark } from './Wordmark';
import { Button, Field, Muted, Screen } from './ui';

type Step =
  | { kind: 'instance' }
  | { kind: 'password'; notice?: string }
  | { kind: 'code'; challenge: string }
  | { kind: 'forgot' }
  | { kind: 'setup' };

const message = (failure: unknown) => (failure instanceof SignInError ? failure.message : t('common.error'));

export function SignIn({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [baseUrl, setBaseUrl] = useState(instanceUrl());
  const [step, setStep] = useState<Step>({ kind: baseUrl ? 'password' : 'instance' });
  const [googleClient, setGoogleClient] = useState<string | null>(null);

  useEffect(() => {
    if (!baseUrl) return;
    let live = true;
    // A brand-new instance has nobody to sign in yet: straight to creating the account.
    void setupOpen(baseUrl).then((open) => live && open && setStep({ kind: 'setup' }));
    createApiClient(baseUrl)
      .GET('/api/auth/google/providers')
      .then(({ data }) => live && setGoogleClient(data?.google ? (data.google_client_id ?? null) : null))
      .catch(() => live && setGoogleClient(null));
    return () => {
      live = false;
    };
  }, [baseUrl]);

  let card: ReactNode;
  if (step.kind === 'instance' || !baseUrl)
    card = (
      <InstanceStep
        onReady={(url) => {
          setBaseUrl(url);
          setStep({ kind: 'password' });
        }}
      />
    );
  else if (step.kind === 'setup') card = <Setup baseUrl={baseUrl} onSignedIn={onSignedIn} />;
  else if (step.kind === 'forgot')
    card = <Forgot baseUrl={baseUrl} onBack={() => setStep({ kind: 'password' })} />;
  else if (step.kind === 'code')
    card = (
      <CodeStep
        baseUrl={baseUrl}
        challenge={step.challenge}
        onBack={() => setStep({ kind: 'password' })}
        onExpired={() => setStep({ kind: 'password', notice: t('signIn.error.expired') })}
        onSignedIn={onSignedIn}
      />
    );
  else
    card = (
      <PasswordStep
        key={step.notice ?? ''}
        baseUrl={baseUrl}
        notice={step.notice}
        googleClient={googleClient}
        onChallenge={(challenge) => setStep({ kind: 'code', challenge })}
        onForgot={() => setStep({ kind: 'forgot' })}
        onChangeInstance={() => setStep({ kind: 'instance' })}
        onSignedIn={onSignedIn}
      />
    );

  return (
    <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
      <Screen>
        <View style={{ gap: 16, paddingTop: 24 }}>
          <Brand />
          {card}
          <Muted style={{ textAlign: 'center' }}>{t('signIn.footer')}</Muted>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

function Brand() {
  const c = useTheme();
  return (
    <View style={{ gap: 10, paddingBottom: 8 }}>
      <Wordmark />
      <Text style={{ color: c.fg, fontSize: 24, fontWeight: '700', letterSpacing: -0.3 }}>
        {t('app.claim')}
      </Text>
      <Muted>{t('signIn.panel')}</Muted>
    </View>
  );
}

function Title({ title, sub }: { title: string; sub?: string }) {
  const c = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text accessibilityRole="header" style={{ color: c.fg, fontSize: 20, fontWeight: '700' }}>
        {title}
      </Text>
      {sub ? <Muted>{sub}</Muted> : null}
    </View>
  );
}

function LinkButton({ children, onPress }: { children: string; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={10}>
      <Text style={{ color: c.accent, fontWeight: '600' }}>{children}</Text>
    </Pressable>
  );
}

function InstanceStep({ onReady }: { onReady: (url: string) => void }) {
  const [url, setUrl] = useState(instanceUrl() ?? DEFAULT_INSTANCE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = async () => {
    setBusy(true);
    setError(null);
    try {
      onReady(await checkInstance(url));
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Muted>{t('mobile.instanceHelp')}</Muted>
      <ErrorBox message={error} />
      <Field
        label={t('mobile.instance')}
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Button primary disabled={busy || !url.trim()} onPress={() => void next()}>
        {t('mobile.continue')}
      </Button>
    </>
  );
}

function PasswordStep({
  baseUrl,
  notice,
  googleClient,
  onChallenge,
  onForgot,
  onChangeInstance,
  onSignedIn,
}: {
  baseUrl: string;
  notice?: string;
  googleClient: string | null;
  onChallenge: (challenge: string) => void;
  onForgot: () => void;
  onChangeInstance: () => void;
  onSignedIn: (session: Session) => void;
}) {
  const c = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'password' | 'passkey' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(notice ?? null);

  const run = async (which: 'password' | 'passkey' | 'google', work: () => Promise<void>) => {
    setBusy(which);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(null);
    }
  };

  const submit = () => {
    if (!validEmail(email)) return setError(t('signIn.error.invalidEmail'));
    if (!password) return setError(t('signIn.error.noPassword'));
    void run('password', async () => onChallenge(await passwordStep(baseUrl, email.trim(), password)));
  };

  const passkey = () =>
    run('passkey', async () => {
      const session = await passkeyStep(baseUrl);
      if (session) onSignedIn(session);
    });

  const google = () =>
    run('google', async () => {
      if (!googleClient) return;
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
    <>
      <Title title={t('signIn.welcome')} sub={t('signIn.sub')} />
      <ErrorBox message={error} />
      <Field
        label={t('signIn.email')}
        value={email}
        onChangeText={(v) => setEmail(v.trim())}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="username"
      />
      <PasswordField
        label={t('signIn.password')}
        value={password}
        onChangeText={setPassword}
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={submit}
      />
      <View style={{ alignItems: 'flex-end' }}>
        <LinkButton onPress={onForgot}>{t('signIn.forgot')}</LinkButton>
      </View>
      <Button primary disabled={busy !== null} onPress={submit}>
        {busy === 'password' ? t('common.loading') : t('signIn.submit')}
      </Button>
      <Muted style={{ textAlign: 'center' }}>{t('signIn.or')}</Muted>
      {passkeysSupported() && (
        <Pressable
          accessibilityRole="button"
          disabled={busy !== null}
          onPress={() => void passkey()}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: c.line,
            backgroundColor: c.surface,
            paddingVertical: 12,
            opacity: busy !== null ? 0.5 : pressed ? 0.8 : 1,
          })}
        >
          <Icon name="passkey" color={c.fg} size={20} />
          <Text style={{ color: c.fg, fontWeight: '600', fontSize: 15 }}>
            {busy === 'passkey' ? t('signIn.passkeyWaiting') : t('signIn.passkey')}
          </Text>
        </Pressable>
      )}
      {googleClient && (
        <Button disabled={busy !== null} onPress={() => void google()}>
          {t('signIn.google')}
        </Button>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingTop: 4 }}>
        <Muted style={{ flex: 1 }}>{baseUrl.replace(/^https?:\/\//, '')}</Muted>
        <LinkButton onPress={onChangeInstance}>{t('mobile.changeInstance')}</LinkButton>
      </View>
      <Muted>{t('mobile.fingerprintNote')}</Muted>
    </>
  );
}

function CodeStep({
  baseUrl,
  challenge,
  onBack,
  onExpired,
  onSignedIn,
}: {
  baseUrl: string;
  challenge: string;
  onBack: () => void;
  onExpired: () => void;
  onSignedIn: (session: Session) => void;
}) {
  const verify = async (code: string): Promise<string | null> => {
    if (challengeExpired(challenge)) {
      onExpired();
      return null;
    }
    try {
      onSignedIn(await codeStep(baseUrl, challenge, code));
      return null;
    } catch (failure) {
      if (challengeExpired(challenge)) {
        onExpired();
        return null;
      }
      return message(failure);
    }
  };
  return (
    <>
      <Title title={t('signIn.codeTitle')} sub={t('signIn.codeSub')} />
      <CodeBoxes submitLabel={t('signIn.verify')} onCode={verify} />
      <LinkButton onPress={onBack}>{t('signIn.back')}</LinkButton>
    </>
  );
}

function Forgot({ baseUrl, onBack }: { baseUrl: string; onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    if (!validEmail(email)) return setError(t('signIn.error.invalidEmail'));
    setBusy(true);
    setError(null);
    try {
      await forgotPassword(baseUrl, email.trim());
      setSent(true);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Title title={t('recover.title')} sub={sent ? undefined : t('recover.sub')} />
      {sent ? (
        <View accessibilityRole="alert" style={{ gap: 8 }}>
          <Muted>{t('recover.sent')}</Muted>
          <Muted>{t('mobile.resetOnWeb')}</Muted>
        </View>
      ) : (
        <>
          <ErrorBox message={error} />
          <Field
            label={t('signIn.email')}
            value={email}
            onChangeText={(v) => setEmail(v.trim())}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
          />
          <Button primary disabled={busy} onPress={() => void send()}>
            {t('recover.send')}
          </Button>
        </>
      )}
      <LinkButton onPress={onBack}>{t('recover.back')}</LinkButton>
    </>
  );
}
