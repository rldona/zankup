import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

import { api } from '../api';
import { t } from '../i18n';
import { Wordmark } from '../Wordmark';
import { ErrorBox } from '../signin/CodeForm';
import { passwordStrength } from '@zankup/core';
import { Waves } from '../signin/Waves';

/** The sign-in screen's frame: brand panel with waves, and the card. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="login">
      <section className="lart">
        <Waves />
        <Wordmark height="1.5rem" />
        <div>
          <h2>{t('app.claim')}</h2>
          <p>{t('signIn.panel')}</p>
        </div>
      </section>
      <section className="lform">
        <div className="lcard">
          {children}
          <div className="lfoot">{t('signIn.footer')}</div>
        </div>
      </section>
    </div>
  );
}

const detailOf = (error: unknown) => {
  const detail = (error as { detail?: unknown } | undefined)?.detail;
  return typeof detail === 'string' ? detail : t('common.error');
};

/** "Forgot it?" (OS-222): ask for a link by e-mail. The answer never says whether the account exists. */
export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError(t('signIn.error.invalidEmail'));
    setBusy(true);
    setError('');
    try {
      const { response } = await api.POST('/api/auth/password/forgot', { body: { email } });
      if (response.status === 429)
        setError(t('signIn.error.tooMany', { seconds: response.headers.get('Retry-After') ?? '60' }));
      else setSent(true);
    } catch {
      setError(t('signIn.error.network'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame>
      <h1>{t('recover.title')}</h1>
      {sent ? (
        <p className="sub" role="status">
          {t('recover.sent')}
        </p>
      ) : (
        <>
          <div className="sub">{t('recover.sub')}</div>
          <ErrorBox message={error} />
          <form onSubmit={(e) => void submit(e)} noValidate>
            <label className="fld">
              {t('signIn.email')}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value.trim())}
                autoComplete="username"
                autoFocus
              />
            </label>
            <button className="primary block" type="submit" disabled={busy}>
              {t('recover.send')}
            </button>
          </form>
        </>
      )}
      <Link to="/sign-in">{t('recover.back')}</Link>
    </Frame>
  );
}

/** The link from the e-mail: a new password plus a code from the app or a recovery code. */
export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const strength = passwordStrength(password);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 12) return setError(t('setup.error.short'));
    setBusy(true);
    setError('');
    try {
      const { response, error: problem } = await api.POST('/api/auth/password/reset', {
        body: { token, password, code: code.trim() },
      });
      if (response.ok) setDone(true);
      else if (response.status === 429)
        setError(t('signIn.error.tooMany', { seconds: response.headers.get('Retry-After') ?? '30' }));
      else setError(detailOf(problem));
    } catch {
      setError(t('signIn.error.network'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame>
      <h1>{t('reset.title')}</h1>
      {!token ? (
        <p className="sub">{t('reset.noToken')}</p>
      ) : done ? (
        <p className="sub" role="status">
          {t('reset.done')}
        </p>
      ) : (
        <>
          <div className="sub">{t('reset.sub')}</div>
          <ErrorBox message={error} />
          <form onSubmit={(e) => void submit(e)} noValidate>
            <label className="fld">
              {t('signIn.password')}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
              />
              <span className={`meter s${strength}`} aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
              <small className="help">{t('setup.passwordHelp')}</small>
            </label>
            <label className="fld">
              {t('reset.code')}
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                inputMode="text"
                spellCheck={false}
              />
            </label>
            <button className="primary block" type="submit" disabled={busy}>
              {t('reset.save')}
            </button>
          </form>
        </>
      )}
      <Link to="/sign-in">{t('recover.back')}</Link>
    </Frame>
  );
}
