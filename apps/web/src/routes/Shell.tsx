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
import { Mark } from '../Mark';
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
  '/activities': /^\/(activities|search|sync)(\/|$)/,
  '/health': /^\/health(\/|$)/,
  '/goals': /^\/goals(\/|$)/,
  '/profile': /^\/(profile|stats|estimates|gear|settings|review|routes|segments)(\/|$)/,
};

/** Screens pushed over a section, as the app's: on a phone they have no tab bar. */
const PUSHED = /^\/activities\/\d+/;

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
 * Where each screen leads back to, above its title, and where that link shows: the screen it was
 * opened from (Stats for its calendar, heatmap, reviews, routes and segments; Settings for its
 * sections; You for Stats, Estimates and Gear). `show` keeps it to the sizes where nothing else on
 * screen leads back: a phone (the rail names the Coach, the notifications and Settings) or below 1024 px
 * (Settings' list sits beside its sections from there). An activity has its own way back, in the feed.
 */
const PARENTS: {
  match: RegExp;
  to: string;
  label: MessageKey;
  show?: 'phone' | 'compact';
}[] = [
  { match: /^\/(search|sync)$/, to: '/activities', label: 'nav.feed' },
  { match: /^\/(coach|notifications)$/, to: '/', label: 'nav.home', show: 'phone' },
  { match: /^\/settings\/import$/, to: '/settings', label: 'nav.settings' },
  { match: /^\/settings\/./, to: '/settings', label: 'nav.settings', show: 'compact' },
  { match: /^\/settings$/, to: '/profile', label: 'nav.you', show: 'phone' },
  { match: /^\/(stats\/|review\/|routes$|segments$)/, to: '/stats', label: 'nav.stats' },
  { match: /^\/routes\/./, to: '/routes', label: 'routes.title' },
  { match: /^\/segments\/./, to: '/segments', label: 'segments.title' },
  { match: /^\/(stats|estimates|gear)$/, to: '/profile', label: 'nav.you' },
];

function Back({ pathname }: { pathname: string }) {
  const parent = PARENTS.find((p) => p.match.test(pathname));
  if (!parent) return null;
  return (
    <div className={`crumbrow show-${parent.show ?? 'always'}`}>
      <Link to={parent.to} className="crumb">
        <MaterialIcon name="chevron_left" />
        {t(parent.label)}
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
      <div className={`app${PUSHED.test(pathname) ? ' pushed' : ''}`}>
        <aside className="rail">
          <Link to="/" className="brand" aria-label="Zankup">
            <Mark height="2rem" />
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
