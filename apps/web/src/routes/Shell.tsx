import { MATERIAL_ICONS, type MaterialIcon as MaterialIconName, type MessageKey } from '@zankup/core';
import { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';

import { Icon } from '../Icon';
import { MaterialIcon } from '../MaterialIcon';
import { t } from '../i18n';
import { Wordmark } from '../Wordmark';
import { useSync } from '../sync';
import { useOnline } from '../offline';
import { SyncProgress } from '../SyncProgress';
import { useServerLanguage, useServerTheme } from '../theme';

/**
 * The sections, as the app's tabs (OS-903): Home, Activities, Health, Goals and You, in the sidebar on
 * desktop and the tab bar on mobile. Stats, Search, the Coach and Settings are reached as on the app:
 * from You, Home's header and the Activities header.
 */
const SECTIONS: { to: string; icon: MaterialIconName; label: MessageKey }[] = [
  { to: '/', icon: 'home', label: 'nav.home' },
  { to: '/activities', icon: 'cards_stack', label: 'nav.feed' },
  { to: '/health', icon: 'favorite', label: 'nav.health' },
  { to: '/goals', icon: 'flag', label: 'nav.goals' },
  { to: '/profile', icon: 'person', label: 'nav.you' },
];

/** Where each section's screens live, so it stays marked on them (an activity under Activities…). */
const OWNS: Record<string, RegExp> = {
  '/': /^\/(notifications|coach)?$/,
  '/activities': /^\/(activities|search)(\/|$)/,
  '/health': /^\/health(\/|$)/,
  '/goals': /^\/goals(\/|$)/,
  '/profile': /^\/(profile|stats|estimates|gear|settings|sync|review|routes|segments)(\/|$)/,
};

const sectionOf = (pathname: string) => SECTIONS.find((s) => OWNS[s.to]?.test(pathname))?.to;

/** A section's icon, filled while it is the current one, as on the app. */
function SectionIcon({ icon, on }: { icon: MaterialIconName; on: boolean }) {
  const filled = `${icon}-fill`;
  return <MaterialIcon name={on && filled in MATERIAL_ICONS ? (filled as MaterialIconName) : icon} />;
}

function Sections({ pathname }: { pathname: string }) {
  const current = sectionOf(pathname);
  return SECTIONS.map((item) => (
    <Link
      key={item.to}
      to={item.to}
      className={item.to === current ? 'on' : undefined}
      aria-current={item.to === current ? 'page' : undefined}
    >
      <SectionIcon icon={item.icon} on={item.to === current} />
      {t(item.label)}
    </Link>
  ));
}

/**
 * The signed-in frame (OS-202). Desktop: sidebar with the brand, sections and the sync button.
 * Mobile (below 1024 px): top bar with back and sync, and a bottom tab bar. Safe areas respected.
 */
export function Shell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useServerTheme();
  useServerLanguage();
  const online = useOnline();
  const sync = useSync();
  const [sheet, setSheet] = useState(false);
  const syncNow = () => {
    setSheet(true);
    if (!sync.running) sync.start.mutate(false);
  };
  // Back on mobile for every screen that is not a section's own.
  const nested = !SECTIONS.some((s) => s.to === pathname);

  return (
    <div className="app">
      <aside className="side">
        <Link to="/" className="brand" aria-label="Zankup">
          <Wordmark height="1rem" />
        </Link>
        <nav aria-label={t('nav.main')}>
          <Sections pathname={pathname} />
        </nav>
        <div className="grow" />
        <button type="button" className="syncbtn" onClick={syncNow} aria-busy={sync.running}>
          <span className={sync.running ? 'spinning' : undefined}>
            <Icon name="sync" />
          </span>
          {t('nav.sync')}
        </button>
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
          <Wordmark height="0.9rem" />
        </Link>
        <button
          type="button"
          className="iconbtn"
          aria-label={t('nav.sync')}
          onClick={syncNow}
          aria-busy={sync.running}
        >
          <span className={sync.running ? 'spinning' : undefined}>
            <Icon name="sync" />
          </span>
        </button>
      </header>

      <main className="main">
        {!online && (
          <p className="offline" role="status">
            {t('offline.notice')}
          </p>
        )}
        <Outlet />
      </main>

      {sheet && (sync.latest || sync.start.isError) && (
        <div className="sheet" role="dialog" aria-label={t('sync.title')}>
          {sync.start.isError ? (
            <p role="alert">{sync.start.error.message}</p>
          ) : (
            sync.latest && <SyncProgress run={sync.latest} />
          )}
          <div className="actions">
            <Link to="/sync" onClick={() => setSheet(false)}>
              {t('sync.recent')}
            </Link>
            <button type="button" onClick={() => setSheet(false)}>
              {t('sync.close')}
            </button>
          </div>
        </div>
      )}

      <nav className="tabbar" aria-label={t('nav.main')}>
        <Sections pathname={pathname} />
      </nav>
    </div>
  );
}
