import { meQuery } from '@zankup/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';

import { api } from '../api';
import { t } from '../i18n';

/** Who is signed in, settings and sign-out, until the full profile (OS-218). */
export function Profile() {
  const me = useQuery(meQuery(api));
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const signOut = async () => {
    await api.POST('/api/auth/logout');
    queryClient.clear();
    void navigate('/sign-in', { replace: true });
  };

  return (
    <section className="page">
      <h1>{t('profile.title')}</h1>
      <p>
        <strong>{me.data?.display_name ?? me.data?.email}</strong>
        {me.data?.display_name && <span className="state"> · {me.data.email}</span>}
      </p>
      <p className="state">{t('profile.more')}</p>
      <div className="actions">
        <Link to="/settings">{t('nav.settings')}</Link>
        <button type="button" onClick={() => void signOut()}>
          {t('nav.signOut')}
        </button>
      </div>
    </section>
  );
}
