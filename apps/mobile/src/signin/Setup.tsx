/**
 * Creating the account of a brand-new instance from the phone (OS-525), as in the PWA (OS-221): the
 * setup code from the server logs, name, e-mail and password; two-step verification, with the key
 * opened in the authenticator app on this phone; the recovery codes to keep; then loading the Garmin
 * history or going straight to the app.
 */
import { createApiClient, passwordStrength } from '@zankup/core';
import { useState } from 'react';
import { Linking, Share, Text, View } from 'react-native';

import { t } from '../i18n';
import { keepSession, setupAccount, setupTotp, SignInError, type Session, type TotpSetup } from '../session';
import { useTheme } from '../theme';
import { Button, Field, Muted, SwitchRow } from '../ui';
import { CodeBoxes, ErrorBox, PasswordField } from './Fields';
import { groupKey, validEmail } from './rules';

type Step =
  | { kind: 'account' }
  | { kind: 'totp'; totp: TotpSetup }
  | { kind: 'recovery'; session: Session; codes: string[] }
  | { kind: 'done'; session: Session };

const STRENGTH = {
  1: 'setup.strength.weak',
  2: 'setup.strength.fair',
  3: 'setup.strength.good',
  4: 'setup.strength.strong',
} as const;

const message = (failure: unknown) => (failure instanceof SignInError ? failure.message : t('common.error'));

export function Setup({ baseUrl, onSignedIn }: { baseUrl: string; onSignedIn: (session: Session) => void }) {
  const [step, setStep] = useState<Step>({ kind: 'account' });
  if (step.kind === 'totp')
    return (
      <TotpStep
        baseUrl={baseUrl}
        totp={step.totp}
        onExpired={() => setStep({ kind: 'account' })}
        onDone={(session, codes) => setStep({ kind: 'recovery', session, codes })}
      />
    );
  if (step.kind === 'recovery')
    return (
      <Recovery
        baseUrl={baseUrl}
        codes={step.codes}
        onDone={() => setStep({ kind: 'done', session: step.session })}
      />
    );
  if (step.kind === 'done') return <Done session={step.session} onSignedIn={onSignedIn} />;
  return <AccountStep baseUrl={baseUrl} onTotp={(totp) => setStep({ kind: 'totp', totp })} />;
}

function Title({ title, sub }: { title: string; sub: string }) {
  const c = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text accessibilityRole="header" style={{ color: c.fg, fontSize: 20, fontWeight: '700' }}>
        {title}
      </Text>
      <Muted>{sub}</Muted>
    </View>
  );
}

function AccountStep({ baseUrl, onTotp }: { baseUrl: string; onTotp: (totp: TotpSetup) => void }) {
  const c = useTheme();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strength = passwordStrength(password);

  const submit = async () => {
    if (!name.trim()) return setError(t('setup.error.name'));
    if (!validEmail(email)) return setError(t('signIn.error.invalidEmail'));
    if (password.length < 12) return setError(t('setup.error.short'));
    if (!accept) return setError(t('setup.error.accept'));
    setBusy(true);
    setError(null);
    try {
      onTotp(
        await setupAccount(baseUrl, {
          code,
          display_name: name.trim(),
          email: email.trim(),
          password,
          accept,
        }),
      );
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Title title={t('setup.title')} sub={t('setup.sub')} />
      <ErrorBox message={error} />
      <Field
        label={t('setup.code')}
        value={code}
        onChangeText={setCode}
        placeholder="XXXX-XXXX-XXXX"
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <Muted>{t('setup.codeHelp')}</Muted>
      <Field label={t('setup.name')} value={name} onChangeText={setName} autoComplete="name" />
      <Field
        label={t('signIn.email')}
        value={email}
        onChangeText={(v) => setEmail(v.trim())}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
      />
      <PasswordField
        label={t('signIn.password')}
        value={password}
        onChangeText={setPassword}
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <View style={{ flexDirection: 'row', gap: 4 }} accessible={false}>
        {[1, 2, 3, 4].map((i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: i <= strength ? (strength < 2 ? c.zone5 : c.accent) : c.line,
            }}
          />
        ))}
      </View>
      <Muted>
        {strength > 0 ? `${t(STRENGTH[strength as 1 | 2 | 3 | 4])} · ` : ''}
        {t('setup.passwordHelp')}
      </Muted>
      <SwitchRow label={t('setup.accept')} value={accept} onChange={setAccept} />
      <Button primary disabled={busy} onPress={() => void submit()}>
        {busy ? t('common.loading') : t('setup.continue')}
      </Button>
    </>
  );
}

function TotpStep({
  baseUrl,
  totp,
  onExpired,
  onDone,
}: {
  baseUrl: string;
  totp: TotpSetup;
  onExpired: () => void;
  onDone: (session: Session, codes: string[]) => void;
}) {
  const c = useTheme();
  const [noApp, setNoApp] = useState(false);
  const verify = async (code: string): Promise<string | null> => {
    try {
      const result = await setupTotp(baseUrl, totp.setup_token, code);
      if (result === 'expired') {
        onExpired();
        return null;
      }
      onDone(result.session, result.codes);
      return null;
    } catch (failure) {
      return message(failure);
    }
  };
  return (
    <>
      <Title title={t('setup.totpTitle')} sub={t('mobile.totpSub')} />
      <Button primary onPress={() => void Linking.openURL(totp.uri).catch(() => setNoApp(true))}>
        {t('mobile.openAuthenticator')}
      </Button>
      {noApp && <Muted accessibilityRole="alert">{t('mobile.noAuthenticator')}</Muted>}
      <Muted>{t('mobile.typeKey')}</Muted>
      <Text
        selectable
        style={{ color: c.fg, fontFamily: 'monospace', fontSize: 18, textAlign: 'center', letterSpacing: 1 }}
      >
        {groupKey(totp.secret)}
      </Text>
      <CodeBoxes submitLabel={t('setup.totpVerify')} onCode={verify} />
    </>
  );
}

function Recovery({ baseUrl, codes, onDone }: { baseUrl: string; codes: string[]; onDone: () => void }) {
  const c = useTheme();
  const [saved, setSaved] = useState(false);
  const text = `Zankup recovery codes\n${baseUrl.replace(/^https?:\/\//, '')}\n\n${codes.join('\n')}\n`;
  return (
    <>
      <Title title={t('setup.recoveryTitle')} sub={t('setup.recoverySub')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {codes.map((code) => (
          <Text
            key={code}
            selectable
            style={{
              color: c.fg,
              fontFamily: 'monospace',
              fontSize: 16,
              width: '47%',
              paddingVertical: 6,
              textAlign: 'center',
              backgroundColor: c.surface,
              borderRadius: 8,
            }}
          >
            {code}
          </Text>
        ))}
      </View>
      <Button onPress={() => void Share.share({ message: text })}>{t('mobile.shareCodes')}</Button>
      <SwitchRow label={t('setup.saved')} value={saved} onChange={setSaved} />
      <Button primary disabled={!saved} onPress={onDone}>
        {t('setup.continue')}
      </Button>
    </>
  );
}

function Done({ session, onSignedIn }: { session: Session; onSignedIn: (session: Session) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keeping the session asks for the fingerprint; cancelled, it can be asked again from here.
  const finish = async (history: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const kept = await keepSession(session);
      // OS-226: the whole Garmin history, as a background job followed on the Sync tab.
      if (history)
        await createApiClient(session.baseUrl)
          .POST('/api/sync', {
            body: { history: true },
            headers: { Authorization: `Bearer ${session.accessToken}` },
          })
          .catch(() => undefined); // the Sync tab can start it again
      onSignedIn(kept);
    } catch {
      setError(t('common.error'));
      setBusy(false);
    }
  };
  return (
    <>
      <Title title={t('setup.doneTitle')} sub={t('setup.doneSub')} />
      <Muted>• {t('setup.next.garmin')}</Muted>
      <Muted>• {t('setup.next.strava')}</Muted>
      <ErrorBox message={error} />
      <Button primary disabled={busy} onPress={() => void finish(true)}>
        {t('setup.loadHistory')}
      </Button>
      <Button disabled={busy} onPress={() => void finish(false)}>
        {t('setup.goToApp')}
      </Button>
    </>
  );
}
