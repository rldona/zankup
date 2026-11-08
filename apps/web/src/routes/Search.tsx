import {
  formatActivityDate,
  formatDuration,
  formatHoursMinutes,
  formatters,
  localStart,
  profileSummaryQuery,
  searchQuery,
  SPORTS,
  usesPace,
  type ActivitySummary,
  type MessageKey,
  type Sport,
} from '@zankup/core';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

import { api } from '../api';
import { locale, t } from '../i18n';
import { usePrefs } from '../prefs';
import { apiParams, FILTER_KEYS } from '../search/params';
import { SportGlyph, SportIcon } from '../SportIcon';

const CHOOSABLE = SPORTS.filter((s) => s !== 'other');
const SORTS = ['date', 'distance', 'duration', 'elevation', 'speed'] as const;
const asSport = (value: string): Sport =>
  (SPORTS as readonly string[]).includes(value) ? (value as Sport) : 'other';

/**
 * Advanced search (OS-219): text, sports, period, distance, time, elevation, HR, "with record",
 * "with description", "with GPS track" and source, sorted, with a summary of all the matches. The
 * search lives in the URL. Filters in a side column on desktop, in a bottom sheet on mobile.
 */
export function Search() {
  const [url, setUrl] = useSearchParams();
  const prefs = usePrefs();
  const format = useMemo(() => formatters(prefs), [prefs]);
  const [today] = useState(() => new Date());
  const params = useMemo(() => apiParams(url, prefs.units, today), [url, prefs.units, today]);
  const results = useInfiniteQuery(searchQuery(api, params));
  const [sheet, setSheet] = useState(false);
  const totals = results.data?.pages[0]?.totals;
  const items = results.data?.pages.flatMap((p) => p.items) ?? [];

  const update = (change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(url);
    change(next);
    setUrl(next, { replace: true });
  };
  const set = (key: string, value: string | null) =>
    update((next) => (value == null || value === '' ? next.delete(key) : next.set(key, value)));
  const toggle = (key: string, value: string) =>
    update((next) => {
      const values = next.getAll(key);
      next.delete(key);
      for (const v of values.includes(value) ? values.filter((x) => x !== value) : [...values, value])
        next.append(key, v);
    });

  const summary = totals
    ? t('search.summary', {
        count: totals.count,
        distance: format.distance(totals.distance_m),
        time: formatHoursMinutes(totals.moving_s),
        ascent: format.elevation(totals.ascent_m),
      })
    : '';

  return (
    <section className="page search">
      <h1>{t('nav.search')}</h1>
      <TextBox value={url.get('q') ?? ''} onChange={(v) => set('q', v)} />
      <div className="searchbar">
        <button type="button" className="only-mobile" onClick={() => setSheet(true)}>
          {t('search.filters')}
        </button>
        <label className="sortby">
          {t('search.sort')}
          <select
            value={url.get('sort') ?? 'date'}
            onChange={(e) => set('sort', e.target.value === 'date' ? null : e.target.value)}
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`search.sort.${s}`)}
              </option>
            ))}
          </select>
          <select
            aria-label={t('search.sort')}
            value={url.get('order') ?? 'desc'}
            onChange={(e) => set('order', e.target.value === 'desc' ? null : e.target.value)}
          >
            <option value="desc">{t('search.descending')}</option>
            <option value="asc">{t('search.ascending')}</option>
          </select>
        </label>
      </div>
      <ActiveFilters
        url={url}
        unit={format.unit}
        onRemove={(key, value) => (value ? toggle(key, value) : set(key, null))}
        onClear={() => setUrl(url.get('q') ? { q: url.get('q') ?? '' } : {}, { replace: true })}
      />

      <div className="searchgrid">
        <aside className={`filters${sheet ? ' open' : ''}`} aria-label={t('search.filters')}>
          <Filters url={url} unit={format.unit} set={set} toggle={toggle} />
          <button type="button" className="primary block only-mobile" onClick={() => setSheet(false)}>
            {t('search.show', { count: totals?.count ?? 0 })}
          </button>
        </aside>

        <div className="results">
          <p className="note num" aria-live="polite">
            {summary}
          </p>
          {results.isSuccess && items.length === 0 && <p className="state">{t('search.none')}</p>}
          {items.length > 0 && <ResultsTable items={items} format={format} />}
          {results.hasNextPage && (
            <button
              type="button"
              className="more"
              onClick={() => void results.fetchNextPage()}
              disabled={results.isFetchingNextPage}
            >
              {results.isFetchingNextPage ? t('common.loading') : t('feed.more')}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/** The text box, sent to the URL a moment after typing stops. */
function TextBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => {
    if (text === value) return;
    const timer = setTimeout(() => onChange(text), 300);
    return () => clearTimeout(timer);
  }, [text, value, onChange]);
  return (
    <input
      type="search"
      className="searchbox"
      placeholder={t('search.placeholder')}
      aria-label={t('nav.search')}
      value={text}
      onChange={(e) => setText(e.target.value)}
    />
  );
}

function Filters({
  url,
  unit,
  set,
  toggle,
}: {
  url: URLSearchParams;
  unit: string;
  set: (key: string, value: string | null) => void;
  toggle: (key: string, value: string) => void;
}) {
  const summary = useQuery(profileSummaryQuery(api));
  const first = summary.data?.since ? new Date(summary.data.since).getFullYear() : new Date().getFullYear();
  const years = Array.from(
    { length: new Date().getFullYear() - first + 1 },
    (_, i) => new Date().getFullYear() - i,
  );
  const period = url.get('period') ?? 'all';
  const range = (label: string, min: string, max?: string) => (
    <fieldset className="range">
      <legend>{label}</legend>
      <input
        type="number"
        min={0}
        inputMode="decimal"
        aria-label={`${label} · ${t('search.min')}`}
        placeholder={t('search.min')}
        value={url.get(min) ?? ''}
        onChange={(e) => set(min, e.target.value)}
      />
      {max && (
        <input
          type="number"
          min={0}
          inputMode="decimal"
          aria-label={`${label} · ${t('search.max')}`}
          placeholder={t('search.max')}
          value={url.get(max) ?? ''}
          onChange={(e) => set(max, e.target.value)}
        />
      )}
    </fieldset>
  );
  const check = (key: string, label: MessageKey) => (
    <label className="check">
      <input
        type="checkbox"
        checked={url.get(key) === '1'}
        onChange={(e) => set(key, e.target.checked ? '1' : null)}
      />
      {t(label)}
    </label>
  );
  return (
    <>
      <h3>{t('search.sports')}</h3>
      <div className="chips wrap" role="group" aria-label={t('search.sports')}>
        {CHOOSABLE.map((s) => (
          <button
            key={s}
            type="button"
            className="chip"
            aria-pressed={url.getAll('sport').includes(s)}
            onClick={() => toggle('sport', s)}
          >
            <SportGlyph sport={s} />
            {t(`sport.${s}`)}
          </button>
        ))}
      </div>
      <h3>{t('search.period')}</h3>
      <select
        aria-label={t('search.period')}
        value={period}
        onChange={(e) => set('period', e.target.value === 'all' ? null : e.target.value)}
      >
        <option value="all">{t('search.period.all')}</option>
        <option value="year">{t('search.period.year')}</option>
        <option value="last12">{t('search.period.last12')}</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
        <option value="custom">{t('search.period.custom')}</option>
      </select>
      {period === 'custom' && (
        <div className="range">
          <label>
            {t('search.from')}
            <input type="date" value={url.get('from') ?? ''} onChange={(e) => set('from', e.target.value)} />
          </label>
          <label>
            {t('search.to')}
            <input type="date" value={url.get('to') ?? ''} onChange={(e) => set('to', e.target.value)} />
          </label>
        </div>
      )}
      {range(t('search.distance', { unit }), 'dmin', 'dmax')}
      {range(t('search.duration'), 'tmin', 'tmax')}
      {range(t('search.minAscent'), 'amin')}
      {range(t('search.hr'), 'hmin', 'hmax')}
      <div className="checks">
        {check('record', 'search.withRecord')}
        {check('desc', 'search.withDescription')}
        {check('gps', 'search.withGps')}
      </div>
      <h3>{t('search.source')}</h3>
      <div className="checks">
        {(['garmin', 'strava'] as const).map((s) => (
          <label key={s} className="check">
            <input
              type="checkbox"
              checked={url.getAll('source').includes(s)}
              onChange={() => toggle('source', s)}
            />
            {s === 'garmin' ? 'Garmin' : 'Strava'}
          </label>
        ))}
      </div>
    </>
  );
}

/** The active filters as chips: one tap removes each. */
function ActiveFilters({
  url,
  unit,
  onRemove,
  onClear,
}: {
  url: URLSearchParams;
  unit: string;
  onRemove: (key: string, value?: string) => void;
  onClear: () => void;
}) {
  const chips: { key: string; value?: string; label: ReactNode }[] = [];
  for (const key of FILTER_KEYS) {
    for (const value of url.getAll(key)) {
      const label =
        key === 'sport'
          ? t(`sport.${asSport(value)}`)
          : key === 'source'
            ? value === 'garmin'
              ? 'Garmin'
              : 'Strava'
            : key === 'period'
              ? value === 'year'
                ? t('search.period.year')
                : value === 'last12'
                  ? t('search.period.last12')
                  : value === 'custom'
                    ? `${url.get('from') ?? '…'} – ${url.get('to') ?? '…'}`
                    : value
              : key === 'record'
                ? t('search.withRecord')
                : key === 'desc'
                  ? t('search.withDescription')
                  : key === 'gps'
                    ? t('search.withGps')
                    : `${{ dmin: `≥ ${value} ${unit}`, dmax: `≤ ${value} ${unit}`, tmin: `≥ ${value} min`, tmax: `≤ ${value} min`, amin: `≥ ${value} m`, hmin: `≥ ${value} bpm`, hmax: `≤ ${value} bpm` }[key] ?? value}`;
      chips.push({ key, value: key === 'sport' || key === 'source' ? value : undefined, label });
    }
  }
  if (!chips.length) return null;
  return (
    <div className="chips wrap active">
      {chips.map((chip) => (
        <button
          key={`${chip.key}-${chip.value ?? ''}`}
          type="button"
          className="chip on"
          aria-label={t('search.remove', { filter: String(chip.label) })}
          onClick={() => onRemove(chip.key, chip.value)}
        >
          {chip.label} ×
        </button>
      ))}
      <button type="button" className="link" onClick={onClear}>
        {t('search.clear')}
      </button>
    </div>
  );
}

function ResultsTable({
  items,
  format,
}: {
  items: ActivitySummary[];
  format: ReturnType<typeof formatters>;
}) {
  return (
    <div className="panel scroll">
      <table className="num rtable">
        <thead>
          <tr>
            <th scope="col">{t('search.date')}</th>
            <th scope="col">{t('search.name')}</th>
            <th scope="col">{t('feed.stat.distance')}</th>
            <th scope="col">{t('feed.stat.time')}</th>
            <th scope="col" className="wide">
              {t('feed.stat.pace')}
            </th>
            <th scope="col" className="wide">
              {t('feed.stat.ascent')}
            </th>
            <th scope="col" className="wide">
              {t('feed.stat.hr')}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => {
            const sport = asSport(a.sport);
            const time = a.moving_s ?? a.duration_s;
            return (
              <tr key={a.id}>
                <td>{formatActivityDate(localStart(a.start_utc, a.timezone), locale).split(' · ')[0]}</td>
                <td className="nm">
                  <Link to={`/activities/${a.id}`}>
                    <SportIcon sport={sport} />
                    {a.name ?? t(`sport.${sport}`)}
                  </Link>
                </td>
                <td>{a.distance_m ? format.distance(a.distance_m) : '—'}</td>
                <td>{formatDuration(time)}</td>
                <td className="wide">
                  {a.distance_m && time ? format.speedFor(a.distance_m / time, usesPace(sport)) : '—'}
                </td>
                <td className="wide">{a.ascent_m ? format.elevation(a.ascent_m) : '—'}</td>
                <td className="wide">{a.avg_hr ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
