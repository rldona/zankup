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
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type RefObject,
} from 'react';
import { Link, NavLink, Outlet, useMatch, useNavigate, useSearchParams } from 'react-router';

import { api } from '../api';
import { locale, t } from '../i18n';
import { usePrefs } from '../prefs';
import { MaterialIcon } from '../MaterialIcon';
import { SportGlyph, SportIcon } from '../SportIcon';
import { FeedSkeleton } from '../Skeleton';
import { useSyncNow } from '../syncSheet';
import { Icon } from '../Icon';

type Format = ReturnType<typeof formatters>;
const CHIPS = SPORTS.filter((s) => s !== 'other');

/**
 * The feed (OS-204): sport chips, the year so far, cards with the route grouped by month with each
 * month's totals, and more pages as you scroll. The list is the screen, centred; opening an activity
 * navigates to it, with the way back and the previous and next activity above it. The chosen sport
 * lives in the URL (`?sport=run`), so going back to the feed keeps it, and the list keeps its scroll.
 */
export function Feed() {
  const match = useMatch('/activities/:id');
  const detail = match !== null;
  const openId = Number(match?.params.id);
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
  // The list is hidden while an activity is open, which resets its scroll: keep it and put it back.
  const scrolled = useRef(0);
  useLayoutEffect(() => {
    if (!detail && column.current) column.current.scrollTop = scrolled.current;
  }, [detail]);
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
      <section
        className="feedcol"
        ref={column}
        onScroll={(event) => {
          if (!detail) scrolled.current = event.currentTarget.scrollTop;
        }}
      >
        <div className="feedinner">
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
              <button
                key={s}
                type="button"
                className="chip"
                aria-pressed={sport === s}
                onClick={() => pick(s)}
              >
                <SportGlyph sport={s} />
                {t(`sport.${s}`)}
              </button>
            ))}
          </div>
          <YearSoFar months={months.data} format={format} />

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
        </div>
      </section>
      <section className="detailcol">
        {detail && (
          <DetailNav
            items={items}
            openId={openId}
            search={search}
            more={feed.hasNextPage && !feed.isFetchingNextPage ? () => void feed.fetchNextPage() : null}
          />
        )}
        <Outlet />
      </section>
    </div>
  );
}

/**
 * Above an open activity, from 600 px (a phone has the app's floating buttons): the way back to the
 * list, and the activity above and below it in the list, so you can go through them without going back.
 * Reaching the last one loaded asks for the next page, so "Next" keeps going.
 */
function DetailNav({
  items,
  openId,
  search,
  more,
}: {
  items: ActivitySummary[];
  openId: number;
  search: string;
  more: (() => void) | null;
}) {
  const index = items.findIndex((a) => a.id === openId);
  const prev = index > 0 ? items[index - 1] : undefined;
  const next = index >= 0 ? items[index + 1] : undefined;
  const last = index >= 0 && index === items.length - 1;
  useEffect(() => {
    if (last) more?.();
  }, [last, more]);
  const name = (a: ActivitySummary) => a.name ?? t(`sport.${asSport(a.sport)}`);
  const step = (
    to: ActivitySummary | undefined,
    label: string,
    icon: 'chevron_left' | 'chevron_right',
    after: boolean,
  ) =>
    to ? (
      <Link
        to={{ pathname: `/activities/${to.id}`, search }}
        className="stepbtn"
        title={name(to)}
        aria-label={`${label}: ${name(to)}`}
      >
        {!after && <MaterialIcon name={icon} />}
        {label}
        {after && <MaterialIcon name={icon} />}
      </Link>
    ) : (
      <span className="stepbtn" aria-disabled="true">
        {!after && <MaterialIcon name={icon} />}
        {label}
        {after && <MaterialIcon name={icon} />}
      </span>
    );
  return (
    <nav className="detailnav" aria-label={t('feed.title')}>
      <Link to={{ pathname: '/activities', search }} className="stepbtn">
        <MaterialIcon name="chevron_left" />
        {t('nav.feed')}
      </Link>
      {index >= 0 && (
        <div className="steps">
          {step(prev, t('feed.prev'), 'chevron_left', false)}
          {step(next, t('feed.next'), 'chevron_right', true)}
        </div>
      )}
    </nav>
  );
}

/** Above the list: the totals of the latest year with activities of the chosen sport, from the months'. */
function YearSoFar({ months, format }: { months: MonthTotals[] | undefined; format: Format }) {
  const year = months?.[0]?.month.slice(0, 4);
  if (!months || !year) return null;
  const these = months.filter((m) => m.month.startsWith(year));
  const sum = (pick: (m: MonthTotals) => number) => these.reduce((total, m) => total + pick(m), 0);
  const distance = sum((m) => m.distance_m);
  const figures: [string, string][] = [
    [t('feed.stat.count'), sum((m) => m.count).toLocaleString(locale)],
    [
      t('feed.stat.distance'),
      `${Math.round(distance / (format.unit === 'km' ? 1000 : 1609.344)).toLocaleString(locale)} ${format.unit}`,
    ],
    [t('feed.stat.time'), formatHoursMinutes(sum((m) => m.moving_s))],
    [t('feed.stat.ascent'), format.elevation(sum((m) => m.ascent_m))],
  ];
  return (
    <section className="yearsofar" aria-label={t('feed.year', { year })}>
      <h2>{t('feed.year', { year })}</h2>
      <dl className="num">
        {figures.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
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
