import { formatDuration, formatters, reviewQuery, type Review as ReviewData, type Sport } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';

import { api } from '../api';
import { locale, t } from '../i18n';
import { usePrefs } from '../prefs';
import { drawCard, shareImage, type CardFigure } from '../share/card';
import { effortName } from '../stats/format';
import { useResolvedTheme } from '../theme';
import { CardSkeleton, Pulse } from '../Skeleton';

type Format = ReturnType<typeof formatters>;

function shift(period: 'month' | 'year', value: string, by: number): string {
  if (period === 'year') return String(Number(value) + by);
  const [y, m] = value.split('-').map(Number);
  const d = new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function title(period: 'month' | 'year', value: string): string {
  if (period === 'year') return value;
  const [y, m] = value.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, 15)).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function change(now: number, before: number): string | null {
  if (!before) return null;
  const pct = Math.round(((now - before) / before) * 100);
  return `${pct > 0 ? '+' : ''}${pct} %`;
}

/** A month or a year in review (OS-413), as cards that can each be shared as an image. */
export function Review() {
  const params = useParams();
  const period = params.period === 'year' ? 'year' : 'month';
  const now = new Date();
  const value =
    params.value ??
    (period === 'year'
      ? String(now.getFullYear())
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const review = useQuery(reviewQuery(api, period, value));
  const prefs = usePrefs();
  const format = formatters(prefs);
  const heading = title(period, value);
  return (
    <section className="page review">
      <p className="crumbs">
        <Link to="/stats">{t('nav.stats')}</Link>
      </p>
      <div className="statshead">
        <h1>{t(period === 'year' ? 'review.yearTitle' : 'review.monthTitle', { period: heading })}</h1>
        <div className="seg" role="group" aria-label={t('review.period')}>
          <Link
            to={`/review/month/${period === 'month' ? value : `${value}-12`}`}
            aria-current={period === 'month' ? 'page' : undefined}
          >
            {t('review.month')}
          </Link>
          <Link
            to={`/review/year/${value.slice(0, 4)}`}
            aria-current={period === 'year' ? 'page' : undefined}
          >
            {t('review.year')}
          </Link>
        </div>
      </div>
      <nav className="actions" aria-label={t('review.period')}>
        <Link to={`/review/${period}/${shift(period, value, -1)}`}>
          ← {title(period, shift(period, value, -1))}
        </Link>
        <Link to={`/review/${period}/${shift(period, value, 1)}`}>
          {title(period, shift(period, value, 1))} →
        </Link>
      </nav>
      {review.isPending && (
        <Pulse>
          <CardSkeleton lines={2} />
          <CardSkeleton />
        </Pulse>
      )}
      {review.isError && <p className="state">{t('common.error')}</p>}
      {review.data && review.data.totals.count === 0 && <p className="state">{t('review.empty')}</p>}
      {review.data && review.data.totals.count > 0 && (
        <Cards data={review.data} heading={heading} format={format} />
      )}
    </section>
  );
}

function Cards({ data, heading, format }: { data: ReviewData; heading: string; format: Format }) {
  const sports = Object.entries(data.by_sport).sort((a, b) => b[1].moving_s - a[1].moving_s);
  const bars = data.buckets.map((b) => b.distance_m);
  const totals: CardFigure[] = [
    { label: t('review.activities'), value: String(data.totals.count) },
    { label: t('feed.stat.distance'), value: format.distance(data.totals.distance_m) },
    { label: t('feed.stat.time'), value: formatDuration(data.totals.moving_s) },
    { label: t('feed.stat.ascent'), value: format.elevation(data.totals.ascent_m) },
  ];
  const highlight = (key: 'longest' | 'hardest' | 'hilliest') => data[key];
  return (
    <div className="reviewcards">
      <Card title={t('review.totals')} share={{ title: heading, figures: totals, bars }}>
        <dl className="kpis num">
          {totals.map((f, i) => {
            const before =
              [data.previous.count, data.previous.distance_m, data.previous.moving_s, data.previous.ascent_m][
                i
              ] ?? 0;
            const now =
              [data.totals.count, data.totals.distance_m, data.totals.moving_s, data.totals.ascent_m][i] ?? 0;
            const delta = change(now, before);
            return (
              <div key={f.label} className="kpi">
                <dd>{f.value}</dd>
                <dt>
                  {f.label}
                  {delta && <small className="note"> {t('review.vsPrevious', { change: delta })}</small>}
                </dt>
              </div>
            );
          })}
        </dl>
        <Bars data={data} format={format} />
      </Card>
      <Card
        title={t('review.consistency')}
        share={{
          title: heading,
          figures: [
            { label: t('review.activeDays'), value: String(data.active_days) },
            { label: t('review.streak'), value: String(data.longest_streak) },
          ],
          bars,
        }}
      >
        <dl className="kpis num">
          <div className="kpi">
            <dd>{data.active_days}</dd>
            <dt>{t('review.activeDays')}</dt>
          </div>
          <div className="kpi">
            <dd>{data.longest_streak}</dd>
            <dt>{t('review.streak')}</dt>
          </div>
        </dl>
        <ul className="rows">
          {sports.map(([sport, s]) => (
            <li key={sport}>
              <span>
                <b>{t(`sport.${sport as Sport}`)}</b>
                <small className="note">
                  {t('review.activitiesCount', { count: s.count })}
                  {s.distance_m ? ` · ${format.distance(s.distance_m)}` : ''} · {formatDuration(s.moving_s)}
                </small>
              </span>
            </li>
          ))}
        </ul>
      </Card>
      {(['longest', 'hardest', 'hilliest'] as const).map((key) => {
        const a = highlight(key);
        if (!a) return null;
        const figures: CardFigure[] = [
          a.distance_m ? { label: t('feed.stat.distance'), value: format.distance(a.distance_m) } : null,
          { label: t('feed.stat.time'), value: formatDuration(a.moving_s) },
          a.ascent_m ? { label: t('feed.stat.ascent'), value: format.elevation(a.ascent_m) } : null,
          a.load ? { label: t('activity.effort'), value: String(Math.round(a.load)) } : null,
        ].filter((f): f is CardFigure => f !== null);
        return (
          <Card
            key={key}
            title={t(`review.${key}`)}
            share={{
              title: a.name ?? t(`sport.${a.sport as Sport}`),
              subtitle: `${t(`review.${key}`)} · ${heading}`,
              figures,
              sport: a.sport,
            }}
          >
            <p>
              <Link to={`/activities/${a.id}`}>{a.name ?? t(`sport.${a.sport as Sport}`)}</Link>
              <small className="note">
                {' '}
                ·{' '}
                {new Date(`${a.day}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
              </small>
            </p>
            <dl className="kpis num">
              {figures.map((f) => (
                <div key={f.label} className="kpi">
                  <dd>{f.value}</dd>
                  <dt>{f.label}</dt>
                </div>
              ))}
            </dl>
          </Card>
        );
      })}
      {data.records.length > 0 && (
        <Card
          title={t('review.records')}
          share={{
            title: heading,
            subtitle: t('review.records'),
            figures: data.records
              .slice(0, 6)
              .map((r) => ({ label: effortName(r.distance_key), value: formatDuration(r.time_s) })),
          }}
        >
          <ul className="rows">
            {data.records.map((r) => (
              <li key={r.distance_key}>
                <span>
                  <Link to={`/activities/${r.activity_id}`}>{effortName(r.distance_key)}</Link>
                  <small className="note">
                    {r.previous_s ? t('review.beat', { previous: formatDuration(r.previous_s) }) : ''}
                  </small>
                </span>
                <b className="num">{formatDuration(r.time_s)}</b>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {data.gear.length > 0 && (
        <Card
          title={t('review.gear')}
          share={{
            title: heading,
            subtitle: t('review.gear'),
            figures: data.gear.map((g) => ({ label: g.name, value: format.distance(g.distance_m) })),
          }}
        >
          <ul className="rows">
            {data.gear.map((g) => (
              <li key={g.id}>
                <span>
                  <b>{g.name}</b>
                  <small className="note">{t('review.activitiesCount', { count: g.count })}</small>
                </span>
                <b className="num">{format.distance(g.distance_m)}</b>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Bars({ data, format }: { data: ReviewData; format: Format }) {
  const max = Math.max(...data.buckets.map((b) => b.distance_m), 1);
  return (
    <div className="rbars" role="img" aria-label={t('review.barsLabel')}>
      {data.buckets.map((b) => (
        <i
          key={b.start}
          title={`${b.start}: ${format.distance(b.distance_m)}`}
          style={{ height: `${Math.max(b.count ? 4 : 0, (b.distance_m / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function Card({
  title: heading,
  share,
  children,
}: {
  title: string;
  share: { title: string; subtitle?: string; figures: CardFigure[]; bars?: number[]; sport?: string };
  children: ReactNode;
}) {
  const theme = useResolvedTheme();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const blob = await drawCard(
        {
          title: share.title,
          subtitle: share.subtitle ?? heading,
          figures: share.figures,
          bars: share.bars,
          sport: share.sport,
        },
        theme,
      );
      await shareImage(blob, `zankup-${heading.toLowerCase().replace(/\W+/g, '-')}.png`, share.title);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel reviewcard">
      <div className="ph">
        <h2>{heading}</h2>
        <button type="button" className="link" onClick={() => void go()} disabled={busy}>
          {t('share.image')}
        </button>
      </div>
      {children}
    </section>
  );
}
