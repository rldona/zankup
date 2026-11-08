import { meQuery, queryKeys, type Me } from '@zankup/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';

import { api } from '../api';
import { t } from '../i18n';
import { Lockup } from '../Lockup';
import { safeNext } from '../next';
import { deviceName } from '../signin/device';
import { Waves } from '../signin/Waves';
import { assertionJson, passkeysSupported, requestOptions } from '../signin/webauthn';

type Step = { kind: 'password'; notice?: string } | { kind: 'code'; challenge: string };

/** Sign-in (OS-203): brand panel with waves, then password → 6-digit code, or a passkey. */
export function SignIn() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useQuery({ ...meQuery(api), retry: false });
  const [step, setStep] = useState<Step>({ kind: 'password' });

  if (me.data) return <Navigate to={safeNext(params.get('next'))} replace />;

  const signedIn = (user: Me) => {
    queryClient.setQueryData(queryKeys.me, user);
    void navigate(safeNext(params.get('next')), { replace: true });
  };

  return (
    <div className="login">
      <section className="lart">
        <Waves />
        <Lockup size="1.4rem" />
        <div>
          <h2>{t('app.claim')}</h2>
          <p>{t('signIn.panel')}</p>
        </div>
      </section>
      <section className="lform">
        <div className="lcard">
          {step.kind === 'password' ? (
            <PasswordStep
              notice={step.notice}
              onChallenge={(challenge) => setStep({ kind: 'code', challenge })}
              onSignedIn={signedIn}
            />
          ) : (
            <CodeStep
              challenge={step.challenge}
              onBack={() => setStep({ kind: 'password' })}
              onExpired={() => setStep({ kind: 'password', notice: t('signIn.error.expired') })}
              onSignedIn={signedIn}
            />
          )}
          <div className="lfoot">{t('signIn.footer')}</div>
        </div>
      </section>
    </div>
  );
}

/** What the API's answer means for the person signing in. Never says which field was wrong. */
function errorFor(response: Response | undefined): string {
  if (!response) return t('signIn.error.network');
  if (response.status === 403) return t('signIn.error.noTotp');
  if (response.status === 429)
    return t('signIn.error.tooMany', { seconds: response.headers.get('Retry-After') ?? '30' });
  return t('signIn.error.wrong');
}

function PasswordStep({
  notice,
  onChallenge,
  onSignedIn,
}: {
  notice?: string;
  onChallenge: (challenge: string) => void;
  onSignedIn: (user: Me) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState(notice ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError(t('signIn.error.invalidEmail'));
    if (!password) return setError(t('signIn.error.noPassword'));
    setError('');
    setBusy(true);
    try {
      const { data, response } = await api.POST('/api/auth/login', {
        body: { email, password, remember, client: 'web', device_name: deviceName() },
      });
      if (data) onChallenge(data.challenge);
      else setError(errorFor(response));
    } catch {
      setError(errorFor(undefined));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>{t('signIn.welcome')}</h1>
      <div className="sub">{t('signIn.sub')}</div>
      <ErrorBox message={error} />
      <form onSubmit={(e) => void submit(e)} noValidate>
        <label className="fld">
          {t('signIn.email')}
          <input
            type="email"
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value.trim())}
            placeholder="you@example.com"
          />
        </label>
        <label className="fld">
          {t('signIn.password')}
          <span className="pw">
            <input
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              aria-label={show ? t('signIn.hidePassword') : t('signIn.showPassword')}
              aria-pressed={show}
              onClick={() => setShow((v) => !v)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </span>
        </label>
        <div className="lrow">
          <label>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            {t('signIn.remember')}
          </label>
        </div>
        <button className="primary block" type="submit" disabled={busy}>
          {busy ? <span className="spin" aria-label={t('common.loading')} /> : t('signIn.submit')}
        </button>
      </form>
      <PasskeyButton remember={remember} onSignedIn={onSignedIn} onError={setError} />
    </>
  );
}

function PasskeyButton({
  remember,
  onSignedIn,
  onError,
}: {
  remember: boolean;
  onSignedIn: (user: Me) => void;
  onError: (message: string) => void;
}) {
  const [waiting, setWaiting] = useState(false);
  if (!passkeysSupported()) return null;

  const start = async () => {
    onError('');
    setWaiting(true);
    try {
      const options = await api.POST('/api/auth/passkeys/login/options');
      if (!options.data) return onError(errorFor(options.response));
      const credential = (await navigator.credentials.get({
        publicKey: requestOptions(options.data.options),
      })) as PublicKeyCredential | null;
      if (!credential) return;
      const result = await api.POST('/api/auth/passkeys/login', {
        body: { credential: assertionJson(credential), remember, client: 'web', device_name: deviceName() },
      });
      if (result.data && 'email' in result.data) onSignedIn(result.data);
      else onError(result.response.status === 429 ? errorFor(result.response) : t('signIn.error.passkey'));
    } catch (error) {
      // Cancelling the browser's passkey sheet is not an error worth showing.
      if (!(error instanceof DOMException && error.name === 'NotAllowedError'))
        onError(t('signIn.error.passkey'));
    } finally {
      setWaiting(false);
    }
  };

  return (
    <>
      <div className="or">{t('signIn.or')}</div>
      <button type="button" className="block" onClick={() => void start()} disabled={waiting}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="8" cy="8" r="4" />
          <path d="M2 21c1-4 3.5-6 6-6 1.5 0 3 .6 4 1.6M15 11a3 3 0 1 1 3 3v6l-1.5 1.5L15 20v-1l1-1-1-1v-3.2" />
        </svg>
        {waiting ? t('signIn.passkeyWaiting') : t('signIn.passkey')}
      </button>
    </>
  );
}

function CodeStep({
  challenge,
  onBack,
  onExpired,
  onSignedIn,
}: {
  challenge: string;
  onBack: () => void;
  onExpired: () => void;
  onSignedIn: (user: Me) => void;
}) {
  const [digits, setDigits] = useState<string[]>(() => Array(6).fill(''));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const submitted = useRef('');

  useEffect(() => boxes.current[0]?.focus(), []);

  const verify = async (code: string) => {
    if (code.length < 6) return setError(t('signIn.error.incomplete'));
    if (submitted.current === code) return; // auto-submit fires once per complete code
    submitted.current = code;
    setError('');
    setBusy(true);
    try {
      const { data, response } = await api.POST('/api/auth/login/totp', { body: { challenge, code } });
      if (data && 'email' in data) return onSignedIn(data);
      if (response.status === 401 && isExpired(challenge)) return onExpired();
      setError(errorFor(response));
      setDigits(Array(6).fill(''));
      submitted.current = '';
      boxes.current[0]?.focus();
    } catch {
      setError(errorFor(undefined));
      submitted.current = '';
    } finally {
      setBusy(false);
    }
  };

  const update = (next: string[]) => {
    setDigits(next);
    if (next.every(Boolean)) void verify(next.join(''));
  };

  /** Fills from box i: one digit when typed, several when autofilled or typed faster than focus moves. */
  const fill = (i: number, typed: string) => {
    const next = [...digits];
    if (!typed) next[i] = '';
    typed.split('').forEach((digit, k) => {
      if (i + k < 6) next[i + k] = digit;
    });
    update(next);
    if (typed) boxes.current[Math.min(i + typed.length, 5)]?.focus();
  };

  const onInput = (i: number, value: string) => {
    const typed = value.replace(/\D/g, '');
    // A box holding one digit gets a second keystroke appended: keep the new one.
    fill(i, typed.length === 2 && digits[i] ? typed.slice(-1) : typed.slice(0, 6 - i));
  };

  const onKeyDown = (i: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !digits[i]) boxes.current[i - 1]?.focus();
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    event.preventDefault();
    fill(pasted.length === 6 ? 0 : digits.findIndex((d) => !d), pasted);
  };

  return (
    <>
      <h1>{t('signIn.codeTitle')}</h1>
      <div className="sub">{t('signIn.codeSub')}</div>
      <ErrorBox message={error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void verify(digits.join(''));
        }}
        noValidate
      >
        <div className="otp">
          {digits.map((digit, i) => (
            <input
              key={i}
              ref={(el) => {
                boxes.current[i] = el;
              }}
              inputMode="numeric"
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              maxLength={6}
              aria-label={t('signIn.digit', { n: i + 1 })}
              value={digit}
              onChange={(e) => onInput(i, e.target.value)}
              onKeyDown={(e) => onKeyDown(i, e)}
              onPaste={onPaste}
            />
          ))}
        </div>
        <button className="primary block" type="submit" disabled={busy}>
          {busy ? <span className="spin" aria-label={t('common.loading')} /> : t('signIn.verify')}
        </button>
      </form>
      <div className="lrow">
        <button type="button" className="link" onClick={onBack}>
          {t('signIn.back')}
        </button>
      </div>
    </>
  );
}

/** The challenge is a JWT valid for 5 minutes: past its expiry, the password has to be entered again. */
function isExpired(challenge: string): boolean {
  try {
    const part = challenge.split('.')[1] ?? '';
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now();
  } catch {
    return false;
  }
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className={`lerr${message ? ' show' : ''}`} role="alert">
      {message}
    </div>
  );
}
