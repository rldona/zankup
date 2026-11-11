import {
  formatDuration,
  formatters,
  gearQuery,
  sharedPreviewQuery,
  sharesQuery,
  SPORTS,
  type ActivityDetail,
  type PhotoRef,
  type Sport,
} from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { api } from '../api';
import { MaterialIcon } from '../MaterialIcon';
import { CardTitle } from '../ui';
import { locale, t } from '../i18n';
import { usePrefs } from '../prefs';
import { drawCard, shareImage } from '../share/card';
import { useResolvedTheme } from '../theme';

/** A modal dialog that is open while mounted, and closes with Escape or its close button. */
export function Modal({
  title,
  onClose,
  children,
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Another look for this dialog (the latest activity's is a sheet on a phone). */
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // Removing the element ends the modal: no close() on unmount, which would fire onClose (and, with
  // React's double effects in development, close the dialog as soon as it opens).
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal?.();
  }, []);
  return (
    <dialog
      ref={ref}
      className={className ? `modal ${className}` : 'modal'}
      aria-label={title}
      onClose={onClose}
      onCancel={onClose}
    >
      <header className="ph">
        <h2>{title}</h2>
        <button type="button" className="link" onClick={onClose}>
          {t('common.close')}
        </button>
      </header>
      {children}
    </dialog>
  );
}

function useRefreshActivity(id: number) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['activity', id] });
    void queryClient.invalidateQueries({ queryKey: ['activities'] });
  };
}

/** Edit, share and add photos (OS-408, OS-409, OS-412). */
/**
 * Edit, Share and Add photos: labelled buttons beside the title, or (`floating`, on a phone, as the app)
 * round icons over the map, after the way back.
 */
export function ActivityActions({
  activity,
  floating = false,
}: {
  activity: ActivityDetail;
  floating?: boolean;
}) {
  const [open, setOpen] = useState<'edit' | 'share' | null>(null);
  const navigate = useNavigate();
  const icon = (name: 'edit_square' | 'share', label: string, onClick: () => void) => (
    <button type="button" className="floatbtn" aria-label={label} title={label} onClick={onClick}>
      <MaterialIcon name={name} />
    </button>
  );
  return (
    <div className={floating ? 'floatbar' : 'dactions'}>
      {floating ? (
        <>
          <button
            type="button"
            className="floatbtn"
            aria-label={t('nav.back')}
            title={t('nav.back')}
            onClick={() => void navigate(-1)}
          >
            <MaterialIcon name="arrow_back" />
          </button>
          <span className="grow" />
          {icon('edit_square', t('activity.edit'), () => setOpen('edit'))}
          {icon('share', t('activity.share'), () => setOpen('share'))}
          <AddPhoto activityId={activity.id} icon />
        </>
      ) : (
        <>
          <button type="button" onClick={() => setOpen('edit')}>
            {t('activity.edit')}
          </button>
          <button type="button" onClick={() => setOpen('share')}>
            {t('activity.share')}
          </button>
          <AddPhoto activityId={activity.id} />
        </>
      )}
      {open === 'edit' && <EditActivity activity={activity} onClose={() => setOpen(null)} />}
      {open === 'share' && <ShareActivity activity={activity} onClose={() => setOpen(null)} />}
    </div>
  );
}

function EditActivity({ activity, onClose }: { activity: ActivityDetail; onClose: () => void }) {
  const gear = useQuery(gearQuery(api));
  const refresh = useRefreshActivity(activity.id);
  const [name, setName] = useState(activity.name ?? '');
  const [description, setDescription] = useState(activity.description ?? '');
  const [sport, setSport] = useState(activity.sport);
  const [gearId, setGearId] = useState(activity.gear?.id ?? 0);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH('/api/activities/{activity_id}', {
        params: { path: { activity_id: activity.id } },
        body: { name, description, sport: sport as Sport, gear_id: gearId },
      });
      if (error) throw new Error('save');
    },
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  // Deleting (OS-909), as on the app: after a confirmation, the activity goes with its photos, every
  // list and figure is refreshed, and the feed shows again. Garmin does not bring it back.
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE('/api/activities/{activity_id}', {
        params: { path: { activity_id: activity.id } },
      });
      if (error) throw new Error('delete');
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['activity', activity.id] });
      void queryClient.invalidateQueries();
      onClose();
      void navigate('/activities', { replace: true });
    },
  });
  const choices = (gear.data ?? []).filter((g) => !g.retired || g.id === activity.gear?.id);
  return (
    <Modal title={t('activity.edit')} onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <label className="field">
          <b>{t('activity.name')}</b>
          <input value={name} maxLength={255} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <b>{t('activity.description')}</b>
          <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="field">
          <b>{t('activity.sport')}</b>
          <select value={sport} onChange={(e) => setSport(e.target.value)}>
            {SPORTS.map((s) => (
              <option key={s} value={s}>
                {t(`sport.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <b>{t('gear.title')}</b>
          <select value={gearId} onChange={(e) => setGearId(Number(e.target.value))}>
            <option value={0}>{t('gear.none')}</option>
            {choices.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <p className="note">{t('activity.editNote')}</p>
        <div className="actions">
          <button type="submit" className="primary" disabled={save.isPending}>
            {t('settings.save')}
          </button>
          {save.isError && (
            <span className="note" role="alert">
              {t('common.error')}
            </span>
          )}
        </div>
        <button
          type="button"
          className="danger"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`${t('activity.delete')}?\n\n${t('activity.deleteConfirm')}`)) remove.mutate();
          }}
        >
          <MaterialIcon name="delete" />
          {t('activity.delete')}
        </button>
        {remove.isError && (
          <p className="note" role="alert">
            {t('common.error')}
          </p>
        )}
      </form>
    </Modal>
  );
}

const EXPIRY = [1, 7, 30, 0] as const;

function ShareActivity({ activity, onClose }: { activity: ActivityDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const shares = useQuery(sharesQuery(api, activity.id));
  const [days, setDays] = useState<(typeof EXPIRY)[number]>(7);
  const [showMap, setShowMap] = useState(true);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST('/api/activities/{activity_id}/shares', {
        params: { path: { activity_id: activity.id } },
        body: { days: days || null, show_map: showMap },
      });
      if (!data || error) throw new Error('share');
      return `${location.origin}${data.path ?? ''}`;
    },
    onSuccess: (url) => {
      setCreated(url);
      setCopied(false);
      void queryClient.invalidateQueries({ queryKey: sharesQuery(api, activity.id).queryKey });
    },
  });
  const revoke = useMutation({
    mutationFn: async (id: number) => {
      await api.DELETE('/api/shares/{share_id}', { params: { path: { share_id: id } } });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: sharesQuery(api, activity.id).queryKey }),
  });
  const copy = async () => {
    if (!created) return;
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    try {
      if (nav.share && matchMedia('(pointer: coarse)').matches)
        await nav.share({ url: created, title: activity.name ?? '' });
      else await navigator.clipboard.writeText(created);
      setCopied(true);
    } catch {
      /* the person closed the share sheet */
    }
  };
  return (
    <Modal title={t('share.title')} onClose={onClose}>
      <p className="note">{t('share.privacy')}</p>
      <div className="fields">
        <label className="field">
          <b>{t('share.expires')}</b>
          <select value={days} onChange={(e) => setDays(Number(e.target.value) as (typeof EXPIRY)[number])}>
            {EXPIRY.map((d) => (
              <option key={d} value={d}>
                {d ? t('share.days', { count: d }) : t('share.never')}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={showMap} onChange={(e) => setShowMap(e.target.checked)} />
          {t('share.showMap')}
        </label>
      </div>
      <div className="actions">
        <button type="button" className="primary" onClick={() => create.mutate()} disabled={create.isPending}>
          {t('share.create')}
        </button>
        <ShareImageButton activity={activity} showMap={showMap} />
      </div>
      {created && (
        <div className="sharelink">
          <input readOnly value={created} aria-label={t('share.link')} onFocus={(e) => e.target.select()} />
          <button type="button" onClick={() => void copy()}>
            {copied ? t('share.copied') : t('share.copy')}
          </button>
        </div>
      )}
      {(shares.data ?? []).length > 0 && (
        <>
          <h3>{t('share.active')}</h3>
          <ul className="rows">
            {shares.data?.map((s) => (
              <li key={s.id}>
                <span>
                  <b>
                    {s.expires_at
                      ? t('share.until', { date: new Date(s.expires_at).toLocaleDateString(locale) })
                      : t('share.never')}
                  </b>
                  <small className="note">
                    {t(s.show_map ? 'share.withMap' : 'share.noMap')} · {t('share.views', { count: s.views })}
                  </small>
                </span>
                <button type="button" onClick={() => revoke.mutate(s.id)} disabled={revoke.isPending}>
                  {t('share.revoke')}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}

function ShareImageButton({ activity, showMap }: { activity: ActivityDetail; showMap: boolean }) {
  const theme = useResolvedTheme();
  const prefs = usePrefs();
  const queryClient = useQueryClient();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const make = async () => {
    setState('busy');
    try {
      const shared = await queryClient.fetchQuery(sharedPreviewQuery(api, activity.id, showMap));
      const format = formatters(prefs);
      const moving = shared.moving_s ?? shared.duration_s;
      const figures = [
        shared.distance_m
          ? { label: t('feed.stat.distance'), value: format.distance(shared.distance_m) }
          : null,
        { label: t('feed.stat.time'), value: formatDuration(moving) },
        shared.distance_m && moving
          ? {
              label: t('feed.stat.pace'),
              value: format.speedFor(
                shared.distance_m / moving,
                activity.sport === 'run' || activity.sport === 'walk',
              ),
            }
          : null,
        shared.ascent_m ? { label: t('feed.stat.ascent'), value: format.elevation(shared.ascent_m) } : null,
      ].filter((f): f is { label: string; value: string } => f !== null);
      const blob = await drawCard(
        {
          title: shared.name ?? t(`sport.${activity.sport as Sport}`),
          subtitle: new Date(`${shared.day}T12:00:00`).toLocaleDateString(locale, { dateStyle: 'long' }),
          figures,
          route: shared.route as [number, number][][] | null,
          sport: activity.sport,
        },
        theme,
      );
      await shareImage(blob, `zankup-${activity.id}.png`, shared.name ?? 'Zankup');
      setState('done');
    } catch {
      setState('error');
    }
  };
  return (
    <>
      <button type="button" onClick={() => void make()} disabled={state === 'busy'}>
        {t('share.image')}
      </button>
      {state === 'error' && (
        <span className="note" role="alert">
          {t('common.error')}
        </span>
      )}
    </>
  );
}

// --- photos (OS-412) -------------------------------------------------------------------------------

const MAX_SIDE = 2048;

/** Resize to at most 2048 px as JPEG before uploading: photos stay well under the upload limit. */
async function resized(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('image'))), 'image/jpeg', 0.88),
  );
}

export function AddPhoto({ activityId, icon = false }: { activityId: number; icon?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const refresh = useRefreshActivity(activityId);
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        const body = await resized(file);
        const response = await fetch(`/api/activities/${activityId}/photos`, {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'image/jpeg' },
          credentials: 'same-origin',
        });
        if (!response.ok) throw new Error(String(response.status));
      }
    },
    onSettled: refresh,
  });
  return (
    <>
      {icon ? (
        <button
          type="button"
          className="floatbtn"
          aria-label={upload.isPending ? t('photos.uploading') : t('photos.add')}
          title={t('photos.add')}
          onClick={() => input.current?.click()}
          disabled={upload.isPending}
        >
          <MaterialIcon name="photo_camera" />
        </button>
      ) : (
        <button type="button" onClick={() => input.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? t('photos.uploading') : t('photos.add')}
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) upload.mutate(files);
        }}
      />
      {upload.isError && (
        <span className="note" role="alert">
          {t('photos.error')}
        </span>
      )}
    </>
  );
}

export function Photos({ activityId, photos }: { activityId: number; photos: PhotoRef[] }) {
  const [open, setOpen] = useState<PhotoRef | null>(null);
  const refresh = useRefreshActivity(activityId);
  const remove = useMutation({
    mutationFn: async (id: number) => {
      await api.DELETE('/api/photos/{photo_id}', { params: { path: { photo_id: id } } });
    },
    onSuccess: () => {
      setOpen(null);
      refresh();
    },
  });
  if (!photos.length) return null;
  return (
    <section className="panel">
      <CardTitle>{t('photos.title')}</CardTitle>
      <ul className="gallery">
        {photos.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => setOpen(p)} aria-label={p.caption ?? t('photos.open')}>
              <img
                src={`/api/photos/${p.id}?thumb=true`}
                alt={p.caption ?? ''}
                loading="lazy"
                width={p.width}
                height={p.height}
              />
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <Modal title={open.caption ?? t('photos.title')} onClose={() => setOpen(null)}>
          <img className="photofull" src={`/api/photos/${open.id}`} alt={open.caption ?? ''} />
          <div className="actions">
            <button type="button" onClick={() => remove.mutate(open.id)} disabled={remove.isPending}>
              {t('photos.remove')}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

/** Gear and weather under the header (OS-406, OS-410). */
export function Meta({ activity }: { activity: ActivityDetail }) {
  const prefs = usePrefs();
  const parts: string[] = [];
  if (activity.gear) parts.push(activity.gear.name);
  const w = activity.weather;
  if (w) {
    const bits = [
      w.condition,
      w.temperature != null
        ? `${Math.round(prefs.units === 'imperial' ? w.temperature * 1.8 + 32 : w.temperature)}°`
        : null,
      w.wind_speed != null ? `${t('activity.wind')} ${Math.round(w.wind_speed * 3.6)} km/h` : null,
    ].filter(Boolean);
    if (bits.length) parts.push(bits.join(', '));
  }
  if (!parts.length) return null;
  return <p className="csub meta">{parts.join(' · ')}</p>;
}
