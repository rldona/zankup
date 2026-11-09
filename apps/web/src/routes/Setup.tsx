import { queryKeys, setupStatusQuery, type Me, passwordStrength } from '@zankup/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';

import { api } from '../api';
import { t } from '../i18n';
import { Wordmark } from '../Wordmark';
import { CodeForm, ErrorBox } from '../signin/CodeForm';
import { deviceName } from '../signin/device';
import { Waves } from '../signin/Waves';

type Totp = { setup_token: string; secret: string; uri: string; qr_svg: string };
type Step =
  | { kind: 'account' }
  | { kind: 'totp'; totp: Totp }
  | { kind: 'recovery'; me: Me; codes: string[] }
  | { kind: 'done'; me: Me };

/** First-time sign-up (OS-221): account, two-step verification, recovery codes, all set. */
export function Setup() {
  const status = useQuery({ ...setupStatusQuery(api), retry: false });
  const [step, setStep] = useState<Step>({ kind: 'account' });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  let card: ReactNode;
  if (step.kind === 'done') {
    card = (
      <Done
        onContinue={(to) => {
          queryClient.setQueryData(queryKeys.me, step.me);
          queryClient.setQueryData(queryKeys.setup, { open: false });
          void navigate(to, { replace: true });
        }}
      />
    );
  } else if (step.kind === 'recovery') {
    card = <Recovery codes={step.codes} onDone={() => setStep({ kind: 'done', me: step.me })} />;
  } else if (step.kind === 'totp') {
    card = (
      <TotpStep
        totp={step.totp}
        onExpired={() => setStep({ kind: 'account' })}
        onDone={(me, codes) => setStep({ kind: 'recovery', me, codes })}
      />
    );
  } else if (status.isPending) {
    card = <p className="state">{t('common.loading')}</p>;
  } else if (status.data?.open === false) {
    card = (
      <>
        <h1>{t('setup.closedTitle')}</h1>
        <div className="sub">{t('setup.closedSub')}</div>
        <Link to="/sign-in">{t('setup.toSignIn')}</Link>
      </>
    );
  } else {
    card = <AccountStep onTotp={(totp) => setStep({ kind: 'totp', totp })} />;
  }

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
        <div className="lcard">{card}</div>
      </section>
    </div>
  );
}

const STRENGTH = {
  1: 'setup.strength.weak',
  2: 'setup.strength.fair',
  3: 'setup.strength.good',
  4: 'setup.strength.strong',
} as const;

function AccountStep({ onTotp }: { onTotp: (totp: Totp) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const strength = passwordStrength(password);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError(t('setup.error.name'));
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError(t('signIn.error.invalidEmail'));
    if (password.length < 12) return setError(t('setup.error.short'));
    if (!accept) return setError(t('setup.error.accept'));
    setError('');
    setBusy(true);
    try {
      const {
        data,
        error: problem,
        response,
      } = await api.POST('/api/setup/account', {
        body: { code, display_name: name, email, password, accept },
      });
      if (data) return onTotp(data);
      if (response.status === 401) return setError(t('setup.error.code'));
      if (response.status === 429)
        return setError(t('signIn.error.tooMany', { seconds: response.headers.get('Retry-After') ?? '30' }));
      const detail = (problem as { detail?: unknown } | undefined)?.detail;
      setError(typeof detail === 'string' ? detail : t('common.error'));
    } catch {
      setError(t('signIn.error.network'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>{t('setup.title')}</h1>
      <div className="sub">{t('setup.sub')}</div>
      <ErrorBox message={error} />
      <form onSubmit={(e) => void submit(e)} noValidate>
        <label className="fld">
          {t('setup.code')}
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX"
            autoFocus
          />
          <small className="help">{t('setup.codeHelp')}</small>
        </label>
        <label className="fld">
          {t('setup.name')}
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
        <label className="fld">
          {t('signIn.email')}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value.trim())}
            autoComplete="username"
          />
        </label>
        <label className="fld">
          {t('signIn.password')}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          <span className={`meter s${strength}`} aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <small className="help">
            {strength > 0 ? `${t(STRENGTH[strength as 1 | 2 | 3 | 4])} · ` : ''}
            {t('setup.passwordHelp')}
          </small>
        </label>
        <div className="lrow">
          <label>
            <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
            {t('setup.accept')}
          </label>
        </div>
        <button className="primary block" type="submit" disabled={busy}>
          {busy ? <span className="spin" aria-label={t('common.loading')} /> : t('setup.continue')}
        </button>
      </form>
    </>
  );
}

function TotpStep({
  totp,
  onExpired,
  onDone,
}: {
  totp: Totp;
  onExpired: () => void;
  onDone: (me: Me, codes: string[]) => void;
}) {
  const verify = async (code: string): Promise<string | null> => {
    try {
      const { data, error, response } = await api.POST('/api/setup/totp', {
        body: { setup_token: totp.setup_token, code, client: 'web', device_name: deviceName() },
      });
      if (data) {
        onDone(data.me, data.recovery_codes);
        return null;
      }
      const detail = (error as { detail?: unknown } | undefined)?.detail;
      if (response.status === 401 && typeof detail === 'string' && detail.includes('too long')) {
        onExpired();
        return null;
      }
      return typeof detail === 'string' ? detail : t('common.error');
    } catch {
      return t('signIn.error.network');
    }
  };

  return (
    <>
      <h1>{t('setup.totpTitle')}</h1>
      <div className="sub">{t('setup.totpSub')}</div>
      {/* The QR code is an SVG drawn by our own API from the otpauth:// link. */}
      <div className="qr" dangerouslySetInnerHTML={{ __html: totp.qr_svg }} />
      <details className="key">
        <summary>{t('setup.totpKey')}</summary>
        <code>{totp.secret.match(/.{1,4}/g)?.join(' ')}</code>
      </details>
      <CodeForm submitLabel={t('setup.totpVerify')} onCode={verify} />
    </>
  );
}

function Recovery({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = `Zankup recovery codes\n${location.host}\n\n${codes.join('\n')}\n`;

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
  };
  const download = () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    link.download = 'zankup-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <>
      <h1>{t('setup.recoveryTitle')}</h1>
      <div className="sub">{t('setup.recoverySub')}</div>
      <ol className="codes">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ol>
      <div className="row2">
        <button type="button" className="block" onClick={() => void copy()}>
          {copied ? t('setup.copied') : t('setup.copy')}
        </button>
        <button type="button" className="block" onClick={download}>
          {t('setup.download')}
        </button>
      </div>
      <div className="lrow">
        <label>
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          {t('setup.saved')}
        </label>
      </div>
      <button type="button" className="primary block" disabled={!saved} onClick={onDone}>
        {t('setup.continue')}
      </button>
    </>
  );
}

function Done({ onContinue }: { onContinue: (to: string) => void }) {
  const [busy, setBusy] = useState(false);
  // OS-226: the whole Garmin history from here, as a background job followed on the Sync screen.
  const loadHistory = async () => {
    setBusy(true);
    try {
      await api.POST('/api/sync', { body: { history: true } });
    } finally {
      onContinue('/sync');
    }
  };
  return (
    <>
      <h1>{t('setup.doneTitle')}</h1>
      <div className="sub">{t('setup.doneSub')}</div>
      <ul className="next">
        <li>{t('setup.next.garmin')}</li>
        <li>{t('setup.next.strava')}</li>
      </ul>
      <button type="button" className="primary block" onClick={() => void loadHistory()} disabled={busy}>
        {t('setup.loadHistory')}
      </button>
      <button type="button" className="block" onClick={() => onContinue('/')}>
        {t('setup.goToApp')}
      </button>
    </>
  );
}
