import { healthQuery, meQuery } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useSearchParams } from 'react-router';

import { api } from '../api';
import { t } from '../i18n';
import { Lockup } from '../Lockup';
import { safeNext } from '../next';

/** Placeholder until the sign-in screen (OS-203): brand, claim and the API status. */
export function SignIn() {
  const [params] = useSearchParams();
  const me = useQuery({ ...meQuery(api), retry: false });
  const health = useQuery({ ...healthQuery(api), retry: false });

  if (me.data) return <Navigate to={safeNext(params.get('next'))} replace />;

  const status = health.isPending
    ? { state: 'checking', text: t('api.checking') }
    : health.data?.status === 'ok'
      ? { state: 'ok', text: t('api.connected', { version: health.data.version }) }
      : health.data
        ? { state: 'degraded', text: t('api.degraded') }
        : { state: 'down', text: t('api.down') };

  return (
    <main className="placeholder">
      <h1>
        <Lockup size="2.5rem" />
      </h1>
      <p>{t('app.claim')}</p>
      <p className="soon">{t('signIn.soon')}</p>
      <p className={`status status-${status.state}`} role="status">
        {status.text}
      </p>
    </main>
  );
}
