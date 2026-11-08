import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';

import { Icon, type IconName } from '../Icon';
import { t } from '../i18n';
import { Lockup } from '../Lockup';
import { useServerLanguage, useServerTheme } from '../theme';

const SIDE: { to: string; icon: IconName; label: Parameters<typeof t>[0] }[] = [
  { to: '/', icon: 'feed', label: 'feed.title' },
  { to: '/search', icon: 'search', label: 'nav.search' },
  { to: '/stats', icon: 'stats', label: 'nav.stats' },
  { to: '/profile', icon: 'profile', label: 'nav.profile' },
  { to: '/settings', icon: 'settings', label: 'nav.settings' },
];

const TABS: { to: string; icon: IconName; label: Parameters<typeof t>[0] }[] = [
  { to: '/', icon: 'feed', label: 'nav.feed' },
  { to: '/search', icon: 'search', label: 'nav.search' },
  { to: '/stats', icon: 'stats', label: 'nav.stats' },
  { to: '/sync', icon: 'sync', label: 'nav.sync' },
  { to: '/profile', icon: 'profile', label: 'nav.you' },
];

/** The feed section stays marked while an activity is open (its detail lives under the feed). */
const classFor =
  (to: string, pathname: string) =>
  ({ isActive }: { isActive: boolean }) =>
    isActive || (to === '/' && pathname.startsWith('/activities/')) ? 'on' : undefined;

/**
 * The signed-in frame (OS-202). Desktop: sidebar with the brand, sections and the sync button.
 * Mobile (below 1024 px): top bar with back and sync, and a bottom tab bar. Safe areas respected.
 */
export function Shell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useServerTheme();
  useServerLanguage();
  const nested = pathname.startsWith('/activities/') || pathname === '/settings';

  return (
    <div className="app">
      <aside className="side">
        <Link to="/" className="brand" aria-label="Zankup">
          <Lockup size="1.15rem" />
        </Link>
        <nav aria-label={t('nav.main')}>
          {SIDE.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={classFor(item.to, pathname)}>
              <Icon name={item.icon} />
              {t(item.label)}
            </NavLink>
          ))}
        </nav>
        <div className="grow" />
        <Link to="/sync" className="syncbtn">
          <Icon name="sync" />
          {t('nav.sync')}
        </Link>
      </aside>

      <header className="topbar">
        {nested && (
          <button
            type="button"
            className="iconbtn"
            aria-label={t('nav.back')}
            onClick={() => void navigate(-1)}
          >
            <Icon name="back" />
          </button>
        )}
        <Link to="/" className="brand" aria-label="Zankup">
          <Lockup size="1.05rem" />
        </Link>
        <Link to="/sync" className="iconbtn" aria-label={t('nav.sync')}>
          <Icon name="sync" />
        </Link>
      </header>

      <main className="main">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label={t('nav.main')}>
        {TABS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className={classFor(item.to, pathname)}>
            <Icon name={item.icon} />
            {t(item.label)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
