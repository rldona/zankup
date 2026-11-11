import {
  aiStatusQuery,
  MATERIAL_ICONS,
  type MaterialIcon as MaterialIconName,
  type MessageKey,
} from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';

import { api } from '../api';
import { LatestActivity } from '../LatestActivity';
import { MaterialIcon } from '../MaterialIcon';
import { t } from '../i18n';
import { Wordmark } from '../Wordmark';
import { useSync } from '../sync';
import { SyncNow } from '../syncSheet';
import { useOnline } from '../offline';
import { SyncProgress } from '../SyncProgress';
import { useServerLanguage, useServerTheme } from '../theme';

type Item = { to: string; icon: MaterialIconName; label: MessageKey };

/**
 * The sections, as the app's tabs (OS-903): Home, Activities, Health, Goals and You, in the rail from
 * 600 px and the tab bar below it.
 */
const SECTIONS: Item[] = [
  { to: '/', icon: 'home', label: 'nav.home' },
  { to: '/activities', icon: 'cards_stack', label: 'nav.feed' },
  { to: '/health', icon: 'favorite', label: 'nav.health' },
  { to: '/goals', icon: 'flag', label: 'nav.goals' },
  { to: '/profile', icon: 'person', label: 'nav.you' },
];

/**
 * The foot of the rail: what the app reaches from Home's header (the Coach, the notifications) and from
 * You (Settings). On a phone they stay where the app has them.
 */
const SHORTCUTS: (Item & { owns: RegExp })[] = [
  { to: '/coach', icon: 'wand_stars', label: 'nav.coach', owns: /^\/coach(\/|$)/ },
  { to: '/notifications', icon: 'notifications', label: 'home.notifications', owns: /^\/notifications$/ },
  { to: '/settings', icon: 'settings', label: 'nav.settings', owns: /^\/settings(\/|$)/ },
];

/** Where each section's screens live, so it stays marked on them (an activity under Activities…). */
const OWNS: Record<string, RegExp> = {
  '/': /^\/(notifications|coach)?$/,
  '/activities': /^\/(activities|search)(\/|$)/,
  '/health': /^\/health(\/|$)/,
  '/goals': /^\/goals(\/|$)/,
  '/profile': /^\/(profile|stats|estimates|gear|settings|sync|review|routes|segments)(\/|$)/,
};

const sectionOf = (pathname: string) => SECTIONS.find((s) => OWNS[s.to]?.test(pathname));
const shortcutOf = (pathname: string) => SHORTCUTS.find((s) => s.owns.test(pathname));

/** An icon, filled while it is the current one, as on the app. */
function NavIcon({ icon, on }: { icon: MaterialIconName; on: boolean }) {
  const filled = `${icon}-fill`;
  return <MaterialIcon name={on && filled in MATERIAL_ICONS ? (filled as MaterialIconName) : icon} />;
}

/** A section with its label under the icon, or (at the rail's foot) the icon alone. */
function NavLink({ item, current, bare }: { item: Item; current: string | undefined; bare?: boolean }) {
  const on = item.to === current;
  return (
    <Link
      to={item.to}
      className={on ? 'on' : undefined}
      aria-current={on ? 'page' : undefined}
      aria-label={bare ? t(item.label) : undefined}
      title={bare ? t(item.label) : undefined}
    >
      <NavIcon icon={item.icon} on={on} />
      {!bare && <span>{t(item.label)}</span>}
    </Link>
  );
}

/**
 * The way back from a screen that is not a section's own, above its title: "‹ You" on Stats and the
 * other screens under You, "‹ Feed" on Search. On a phone also on the Coach, the notifications,
 * Settings and an activity, which the rail or the list beside it make plain on larger screens.
 */
function Back({ pathname }: { pathname: string }) {
  const section = sectionOf(pathname);
  if (!section || section.to === pathname) return null;
  const narrowOnly = !!shortcutOf(pathname) || /^\/activities\/./.test(pathname);
  return (
    <div className={`crumbrow${narrowOnly ? ' narrow-only' : ''}`}>
      <Link to={section.to} className="crumb">
        <MaterialIcon name="chevron_left" />
        {t(section.label)}
      </Link>
    </div>
  );
}

/**
 * The signed-in frame (OS-202), in three sizes as the app (docs/prototypes/web): below 600 px the
 * app's bottom tab bar and one header per screen; from 600 px a narrow rail with the sections on top and
 * the Coach, the notifications and Settings at its foot; from 1200 px the content centred at one width.
 * Safe areas respected.
 */
export function Shell() {
  const { pathname } = useLocation();
  useServerTheme();
  useServerLanguage();
  const online = useOnline();
  const sync = useSync();
  const ai = useQuery({ ...aiStatusQuery(api), retry: false });
  const coach = !!(ai.data?.available && ai.data.enabled);
  const [sheet, setSheet] = useState(false);
  const syncNow = () => {
    setSheet(true);
    if (!sync.running) sync.start.mutate(false);
  };
  const shortcut = shortcutOf(pathname)?.to;
  const section = sectionOf(pathname)?.to;

  return (
    <SyncNow.Provider value={{ start: syncNow, running: sync.running }}>
      <div className="app">
        <aside className="rail">
          <Link to="/" className="brand" aria-label="Zankup">
            <Wordmark height="0.6rem" />
          </Link>
          <nav aria-label={t('nav.main')}>
            {SECTIONS.map((item) => (
              <NavLink key={item.to} item={item} current={shortcut ? undefined : section} />
            ))}
          </nav>
          <div className="grow" />
          <div className="railfoot">
            {SHORTCUTS.filter((s) => coach || s.to !== '/coach').map((item) => (
              <NavLink key={item.to} item={item} current={shortcut} bare />
            ))}
          </div>
        </aside>

        <LatestActivity />

        <main className="main">
          {!online && (
            <p className="offline" role="status">
              {t('offline.notice')}
            </p>
          )}
          <Back pathname={pathname} />
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
          {SECTIONS.map((item) => (
            <NavLink key={item.to} item={item} current={section} />
          ))}
        </nav>
      </div>
    </SyncNow.Provider>
  );
}
