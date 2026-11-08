import { meQuery } from '@zankup/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';

import { api } from '../api';
import { t } from '../i18n';
import { Lockup } from '../Lockup';

/** The signed-in frame: header with the brand, navigation and sign-out. The full layout is OS-202. */
export function Shell() {
  const me = useQuery(meQuery(api));
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const signOut = async () => {
    await api.POST('/api/auth/logout');
    queryClient.clear();
    void navigate('/sign-in', { replace: true });
  };

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Zankup">
          <Lockup />
        </Link>
        <nav>
          <NavLink to="/" end>
            {t('nav.feed')}
          </NavLink>
        </nav>
        <span className="who">{me.data?.display_name ?? me.data?.email}</span>
        <button type="button" onClick={() => void signOut()}>
          {t('nav.signOut')}
        </button>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
