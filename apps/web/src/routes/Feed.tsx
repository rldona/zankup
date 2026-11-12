import {
  activitiesQuery,
  formatActivityDate,
  formatDuration,
  formatHoursMinutes,
  formatMonth,
  formatters,
  localStart,
  monthsQuery,
  routeThumbnail,
  SPORTS,
  usesPace,
  type ActivitySummary,
  type MessageKey,
  type MonthTotals,
  type Sport,
} from '@zankup/core';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Fragment, useEffect, useMemo, useRef, type CSSProperties, type RefObject } from 'react';
import { Link, NavLink, Navigate, Outlet, useMatch, useNavigate, useSearchParams } from 'react-router';

import { api } from '../api';
import { locale, t } from '../i18n';
import { useMedia } from '../media';
import { usePrefs } from '../prefs';
import { MaterialIcon } from '../MaterialIcon';
import { SportGlyph, SportIcon } from '../SportIcon';
import { FeedSkeleton } from '../Skeleton';
import { useSyncNow } from '../syncSheet';
import { Icon } from '../Icon';

type Format = ReturnType<typeof formatters>;
const CHIPS = SPORTS.filter((s) => s !== 'other');

/**
 * The feed (OS-204): sport chips, cards with the route, grouped by month with each month's totals, and
 * more pages as you scroll. Beside the detail on desktop (list 400 px); on mobile, one or the other.
 * The chosen sport lives in the URL (`?sport=run`), so going back to the feed keeps it.
 */
export function Feed() {
  const detail = useMatch('/activities/:id') !== null;
  const [params, setParams] = useSearchParams();
  const chosen = params.get('sport');
  const sport = (CHIPS as readonly string[]).includes(chosen ?? '') ? (chosen as Sport) : null;
  const filter = sport ? [sport] : undefined;

  const prefs = usePrefs();
  const format = useMemo(() => formatters(prefs), [prefs]);
  const feed = useInfiniteQuery(activitiesQuery(api, filter));
  const months = useQuery(monthsQuery(api, filter));
  const allMonths = useQuery({ ...monthsQuery(api), enabled: sport !== null });
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const totals = new Map(months.data?.map((m) => [m.month, m]));

  const column = useRef<HTMLElement>(null);
  const sentinel = useMoreOnScroll(column, () => {
    if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
  });

  const pick = (next: Sport | null) => {
    setParams(next ? { sport: next } : {}, { replace: true });
    column.current?.scrollTo?.({ top: 0 });
  };
  const search = params.toString() ? `?${params}` : '';
  const sync = useSyncNow();
  const navigate = useNavigate();

  const cards = items.map((activity, i) => {
    const start = localStart(activity.start_utc, activity.timezone);
    return { activity, start, month: start.slice(0, 7), index: i };
  });

  return (
    <div className={`feedwrap${detail ? ' detail' : ''}`}>
      <section className="feedcol" ref={column}>
        <div className="titlebar">
          <h1>
            {t('feed.title')} <Since months={sport ? allMonths.data : months.data} />
          </h1>
          {/* As the app's Activities header: sync and the training calendar. */}
          <button
            type="button"
            className="iconbtn"
            aria-label={t('nav.sync')}
            title={t('nav.sync')}
            onClick={sync.start}
            aria-busy={sync.running}
          >
            <span className={sync.running ? 'spinning' : undefined}>
              <Icon name="sync" />
            </span>
          </button>
          <Link
            to="/stats/calendar"
            className="iconbtn"
            aria-label={t('stats.calendar')}
            title={t('stats.calendar')}
          >
            <MaterialIcon name="calendar_month" />
          </Link>
        </div>
        {/* As the app: the search bar under the title, then the sports. It opens the search with the
            text, where the filters are. */}
        <form
          role="search"
          className="feedsearch"
          onSubmit={(event) => {
            event.preventDefault();
            const q = new FormData(event.currentTarget).get('q')?.toString().trim();
            void navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
          }}
        >
          <MaterialIcon name="search" />
          <input
            type="search"
            name="q"
            aria-label={t('nav.search')}
            placeholder={t('search.placeholder')}
            enterKeyHint="search"
          />
        </form>
        <div className="chips" role="group" aria-label={t('feed.sports')}>
          <button type="button" className="chip" aria-pressed={sport === null} onClick={() => pick(null)}>
            {t('feed.all')}
          </button>
          {CHIPS.map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={sport === s} onClick={() => pick(s)}>
              <SportGlyph sport={s} />
              {t(`sport.${s}`)}
            </button>
          ))}
        </div>
        {/* On a desktop the chips do not fit (and a mouse has no sideways scroll): a selector instead. */}
        <select
          className="sports-select"
          aria-label={t('feed.sports')}
          value={sport ?? ''}
          onChange={(e) => pick((e.target.value || null) as Sport | null)}
        >
          <option value="">{t('feed.all')}</option>
          {CHIPS.map((s) => (
            <option key={s} value={s}>
              {t(`sport.${s}`)}
            </option>
          ))}
        </select>

        {feed.isPending && <FeedSkeleton />}
        {feed.isError && (
          <p className="state" role="alert">
            {t('common.error')}
          </p>
        )}
        {feed.isSuccess && items.length === 0 && (
          <p className="state">{sport ? t('feed.emptySport') : t('feed.empty')}</p>
        )}

        {cards.map(({ activity, start, month, index }) => (
          <Fragment key={activity.id}>
            {month !== cards[index - 1]?.month && (
              <MonthHeader month={month} totals={totals.get(month)} format={format} />
            )}
            <Card activity={activity} start={start} search={search} format={format} />
          </Fragment>
        ))}

        <div ref={sentinel} />
        {feed.hasNextPage && (
          <button
            type="button"
            className="more"
            onClick={() => void feed.fetchNextPage()}
            disabled={feed.isFetchingNextPage}
          >
            {feed.isFetchingNextPage ? t('common.loading') : t('feed.more')}
          </button>
        )}
        {feed.isSuccess && !feed.hasNextPage && items.length > 0 && (
          <p className="state end">{t('feed.end')}</p>
        )}
      </section>
      <section className="detailcol">
        <Outlet />
      </section>
    </div>
  );
}

/**
 * The detail column on a desktop: the first activity of the current filter opens by itself, so the
 * column is never empty; with none, it says so. On a phone the list is the screen.
 */
export function PickActivity() {
  const [params] = useSearchParams();
  const chosen = params.get('sport');
  const sport = (CHIPS as readonly string[]).includes(chosen ?? '') ? (chosen as Sport) : null;
  const wide = useMedia('(min-width: 1024px)');
  const feed = useInfiniteQuery(activitiesQuery(api, sport ? [sport] : undefined));
  const first = feed.data?.pages[0]?.items[0];
  const search = params.toString() ? `?${params}` : '';

  if (feed.isPending) return null;
  if (feed.isSuccess && !first) return <p className="state pick">{t('feed.none')}</p>;
  if (wide && first) return <Navigate to={`/activities/${first.id}${search}`} replace />;
  return <p className="state pick">{t('feed.pick')}</p>;
}

/**
 * Calls `onMore` when the end of the list comes within 600 px of the scrolling column. Where there is
 * no IntersectionObserver (old browsers, tests), the "Load more" button is still there.
 */
function useMoreOnScroll(root: RefObject<HTMLElement | null>, onMore: () => void) {
  const sentinel = useRef<HTMLDivElement>(null);
  const latest = useRef(onMore);
  useEffect(() => {
    latest.current = onMore;
  });
  useEffect(() => {
    const target = sentinel.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) latest.current();
      },
      { root: root.current, rootMargin: '0px 0px 600px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [root]);
  return sentinel;
}

function Since({ months }: { months: MonthTotals[] | undefined }) {
  const oldest = months?.at(-1);
  if (!months || !oldest) return null;
  const count = months.reduce((sum, m) => sum + m.count, 0);
  return (
    <span className="since">
      · {t('feed.since', { count: count.toLocaleString(locale), year: oldest.month.slice(0, 4) })}
    </span>
  );
}

function MonthHeader({
  month,
  totals,
  format,
}: {
  month: string;
  totals: MonthTotals | undefined;
  format: Format;
}) {
  return (
    <h2 className="mhead">
      <b>{formatMonth(month, locale)}</b>
      {totals && (
        <span className="num">
          {t('feed.monthTotals', {
            count: totals.count,
            distance: Math.round(totals.distance_m / (format.unit === 'km' ? 1000 : 1609.344)).toLocaleString(
              locale,
            ),
            unit: format.unit,
            time: formatHoursMinutes(totals.moving_s),
          })}
        </span>
      )}
    </h2>
  );
}

function asSport(value: string): Sport {
  return (SPORTS as readonly string[]).includes(value) ? (value as Sport) : 'other';
}

function Card({
  activity,
  start,
  search,
  format,
}: {
  activity: ActivitySummary;
  start: string;
  search: string;
  format: Format;
}) {
  const sport = asSport(activity.sport);
  const route = routeThumbnail(activity.route);
  const style = { '--sport': `var(--${sport})` } as CSSProperties;
  return (
    <NavLink
      to={{ pathname: `/activities/${activity.id}`, search }}
      className={({ isActive }) => `card${isActive ? ' on' : ''}`}
      style={style}
    >
      <div className="chead">
        <SportIcon sport={sport} />
        <div className="ctext">
          <div className="ctitle">{activity.name ?? t(`sport.${sport}`)}</div>
          <div className="csub">{formatActivityDate(start, locale)}</div>
        </div>
      </div>
      <div className="cbody">
        <dl className="cstats num">
          {stats(activity, sport, format).map(([label, value]) => (
            <div key={label}>
              <dd>{value}</dd>
              <dt>{t(label)}</dt>
            </div>
          ))}
        </dl>
        {activity.photo ? (
          <img
            className="thumb photo"
            src={`/api/photos/${activity.photo}?thumb=true`}
            alt=""
            loading="lazy"
          />
        ) : route ? (
          <svg className="thumb" viewBox="0 0 88 64" aria-hidden="true">
            <polyline points={route} />
          </svg>
        ) : null}
      </div>
    </NavLink>
  );
}

type Stat = [label: MessageKey, value: string];

/** Three figures per card: distance, time and pace (or speed); time and heart rate when there is no distance. */
function stats(a: ActivitySummary, sport: Sport, format: Format): Stat[] {
  const time = a.moving_s ?? a.duration_s;
  const hr: Stat | null = a.avg_hr ? ['feed.stat.hr', `${a.avg_hr} bpm`] : null;
  if (!a.distance_m) {
    const ascent: Stat | null = a.ascent_m ? ['feed.stat.ascent', format.elevation(a.ascent_m)] : null;
    return [['feed.stat.time', formatDuration(time)], hr, ascent].filter((s): s is Stat => s !== null);
  }
  const speed = time > 0 ? a.distance_m / time : 0;
  return [
    ['feed.stat.distance', format.distance(a.distance_m)],
    ['feed.stat.time', formatDuration(time)],
    usesPace(sport) ? ['feed.stat.pace', format.pace(speed)] : ['feed.stat.speed', format.speed(speed)],
  ];
}
