import { ApiError, meQuery } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation } from 'react-router';

import { api } from '../api';
import { t } from '../i18n';

/** Renders the signed-in part of the app, or sends to /sign-in (keeping where you wanted to go). */
export function RequireSession() {
  const location = useLocation();
  const me = useQuery(meQuery(api));
  const signedOut = me.data === null || (me.error instanceof ApiError && me.error.status === 401);

  if (signedOut) {
    const next = location.pathname + location.search;
    return <Navigate to={`/sign-in${next === '/' ? '' : `?next=${encodeURIComponent(next)}`}`} replace />;
  }
  if (me.isPending) return <p className="state">{t('common.loading')}</p>;
  if (me.isError)
    return (
      <p className="state" role="alert">
        {t('common.error')}{' '}
        <button type="button" onClick={() => void me.refetch()}>
          {t('common.retry')}
        </button>
      </p>
    );
  return <Outlet />;
}
