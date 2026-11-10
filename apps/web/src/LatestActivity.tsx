/**
 * The latest activity on arrival (OS-906), as the app's bottom sheet: when a new activity has synced
 * since the last visit (at most three days old), a panel says so and lets you name it, describe it, add
 * photos beside its map and choose its gear; "Advanced editing" opens the activity. A dialog on desktop,
 * a sheet from below on a phone. Each activity shows once in this browser; the first visit only
 * remembers the newest, so older ones never pop up.
 */
import {
  activitiesQuery,
  activityQuery,
  formatDuration,
  formatters,
  gearQuery,
  SPORTS,
  themes,
  type ActivitySummary,
  type Sport,
} from '@zankup/core';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { api } from './api';
import { AddPhoto, Modal } from './detail/Tools';
import { TrackMap } from './detail/TrackMap';
import { locale, t } from './i18n';
import { usePrefs } from './prefs';
import { SportIcon } from './SportIcon';
import { useResolvedTheme } from './theme';

const SEEN_KEY = 'zankup-latest-seen';

/** Older than this, an activity is not news any more: it is only remembered, never shown. */
const FRESH_MS = 3 * 24 * 3600 * 1000;

const asSport = (value: string): Sport =>
  (SPORTS as readonly string[]).includes(value) ? (value as Sport) : 'other';

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function writeSeen(id: number) {
  try {
    localStorage.setItem(SEEN_KEY, String(id));
  } catch {
    // Storage blocked: the panel may show again next visit, which is harmless.
  }
}

/** The activity to show, if the newest one is new to this browser; remembers the first one silently. */
function useNewest(items: ActivitySummary[]): [ActivitySummary | null, () => void] {
  const newest = items[0] ?? null;
  const [seen, setSeen] = useState(readSeen);
  const [now] = useState(() => Date.now());
  // First visit in this browser: nothing is "new" yet.
  if (newest && seen === null) {
    writeSeen(newest.id);
    setSeen(String(newest.id));
  }
  const fresh =
    newest !== null &&
    seen !== null &&
    seen !== String(newest.id) &&
    now - new Date(newest.start_utc).getTime() < FRESH_MS;
  const done = () => {
    if (!newest) return;
    writeSeen(newest.id);
    setSeen(String(newest.id));
  };
  return [fresh ? newest : null, done];
}

export function LatestActivity() {
  const feed = useInfiniteQuery(activitiesQuery(api));
  const items = feed.data?.pages[0]?.items ?? [];
  const [activity, done] = useNewest(items);
  if (!activity) return null;
  return <LatestPanel key={activity.id} activity={activity} onClose={done} />;
}

function LatestPanel({ activity: a, onClose }: { activity: ActivitySummary; onClose: () => void }) {
  const prefs = usePrefs();
  const theme = useResolvedTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const detail = useQuery(activityQuery(api, a.id));
  const gear = useQuery(gearQuery(api));
  const sport = asSport(a.sport);
  const format = formatters(prefs);
  const [name, setName] = useState(a.name ?? '');
  const [description, setDescription] = useState<string | null>(null);
  const [gearId, setGearId] = useState<number | null>(null);
  const currentGear = detail.data?.gear?.id ?? 0;
  const currentDescription = detail.data?.description ?? '';

  const save = useMutation({
    mutationFn: async () => {
      const body: { name?: string; description?: string; gear_id?: number } = {};
      if (name.trim() && name.trim() !== (a.name ?? '')) body.name = name.trim();
      if (description !== null && description !== currentDescription) body.description = description;
      if (gearId !== null && gearId !== currentGear) body.gear_id = gearId;
      if (Object.keys(body).length === 0) return;
      const { error } = await api.PATCH('/api/activities/{activity_id}', {
        params: { path: { activity_id: a.id } },
        body,
      });
      if (error) throw new Error('save');
      void queryClient.invalidateQueries({ queryKey: ['activity', a.id] });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
    onSuccess: onClose,
  });

  const choices = (gear.data ?? []).filter((g) => !g.retired);
  const time = formatDuration(a.moving_s ?? a.duration_s);
  const stats: [string, string][] = a.distance_m
    ? [
        [t('feed.stat.distance'), format.distance(a.distance_m)],
        [t('feed.stat.ascent'), format.elevation(a.ascent_m ?? 0)],
        [t('feed.stat.time'), time],
      ]
    : [
        [t('feed.stat.time'), time],
        ...(a.avg_hr ? ([[t('metric.hr'), `${Math.round(a.avg_hr)} bpm`]] as [string, string][]) : []),
      ];
  const photos = detail.data?.photo_list ?? [];

  return (
    <Modal title={t('latest.title')} onClose={onClose} className="latest">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="lsub">
          <SportIcon sport={sport} />
          {t(`sport.${sport}`)} ·{' '}
          {new Date(a.start_utc).toLocaleString(locale, {
            weekday: 'long',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
        <label className="field">
          <b>{t('activity.name')}</b>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={255} />
        </label>
        <label className="field">
          <b>{t('latest.description')}</b>
          <textarea
            rows={3}
            value={description ?? currentDescription}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <dl className="lstats num">
          {stats.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="lmedia">
          {a.route && (
            <div className="lmap">
              <TrackMap tracks={[a.route]} colour={themes[theme][sport]} theme={theme} height={150} />
            </div>
          )}
          {photos.map((p) => (
            <img key={p.id} src={`/api/photos/${p.id}?thumb=true`} alt={p.caption ?? ''} loading="lazy" />
          ))}
          <div className="ladd">
            <AddPhoto activityId={a.id} />
          </div>
        </div>
        {choices.length > 0 && (
          <div className="field">
            <b>{t('gear.title')}</b>
            <div className="chips" role="radiogroup" aria-label={t('gear.title')}>
              {[{ id: 0, name: t('gear.none') }, ...choices].map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="chip"
                  role="radio"
                  aria-checked={(gearId ?? currentGear) === g.id}
                  aria-pressed={(gearId ?? currentGear) === g.id}
                  onClick={() => setGearId(g.id)}
                >
                  {g.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {save.isError && (
          <p className="note" role="alert">
            {t('common.error')}
          </p>
        )}
        <button type="submit" className="primary block" disabled={save.isPending}>
          {t('latest.ok')}
        </button>
        <button
          type="button"
          className="link ladv"
          onClick={() => {
            onClose();
            void navigate(`/activities/${a.id}`);
          }}
        >
          {t('latest.advanced')}
        </button>
      </form>
    </Modal>
  );
}
