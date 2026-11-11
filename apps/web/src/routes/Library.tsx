import {
  exportsQuery,
  formatters,
  gearQuery,
  importsQuery,
  SPORTS,
  type ExportOut,
  type GearOut,
  type ImportOut,
  type NewImport,
} from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';

import { api } from '../api';
import { locale, t } from '../i18n';
import { usePrefs } from '../prefs';

const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: 'medium' });
const megabytes = (bytes: number) =>
  `${(bytes / 1024 / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`;

// --- gear (OS-410) ---------------------------------------------------------------------------------

/** "Brand Model", without the brand twice when the model already starts with it. */
function gearModel(g: GearOut): string {
  const brand = g.brand ?? '';
  const model = g.model ?? '';
  return model.toLowerCase().startsWith(brand.toLowerCase()) ? model : `${brand} ${model}`.trim();
}

/** Shoes and bikes with their mileage and a warning past the limit. */
export function Gear() {
  const gear = useQuery(gearQuery(api));
  const prefs = usePrefs();
  const format = formatters(prefs);
  const [editing, setEditing] = useState<GearOut | 'new' | null>(null);
  // The habitual ones first (OS-910), then the rest in use, then the retired.
  const list = gear.data ?? [];
  const ordered = [
    ...list.filter((g) => g.habitual && !g.retired),
    ...list.filter((g) => !g.habitual && !g.retired),
    ...list.filter((g) => g.retired),
  ];
  return (
    <section className="page">
      <h1>{t('gear.title')}</h1>
      <p className="note">{t('gear.help')}</p>
      <div className="actions">
        <button type="button" className="primary" onClick={() => setEditing('new')}>
          {t('gear.add')}
        </button>
      </div>
      {editing && <GearForm gear={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      {gear.data && gear.data.length === 0 && <p className="state">{t('gear.empty')}</p>}
      <ul className="gearlist">
        {ordered.map((g) => {
          const share = g.limit_m ? Math.min(1, g.distance_m / g.limit_m) : null;
          return (
            <li
              key={g.id}
              className={
                g.retired
                  ? 'retired'
                  : [g.habitual && 'habitual', g.over_limit && 'over'].filter(Boolean).join(' ') || undefined
              }
            >
              <div className="ph">
                <h2>
                  {g.name}
                  {g.retired && <span className="badge">{t('gear.retired')}</span>}
                  {g.habitual && !g.retired && <span className="badge good">{t('gear.habitual')}</span>}
                </h2>
                <button type="button" className="link" onClick={() => setEditing(g)}>
                  {t('activity.edit')}
                </button>
              </div>
              <p className="num gearkm">
                <b>{format.distance(g.distance_m)}</b>
                {g.limit_m ? ` / ${format.distance(g.limit_m)}` : ''}
              </p>
              {share != null && (
                <div
                  className="gearbar"
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(share * 100)}
                  aria-label={t('gear.mileage')}
                >
                  <i style={{ width: `${share * 100}%` }} />
                </div>
              )}
              {g.over_limit && <p className="warn">{t('gear.overLimit')}</p>}
              <p className="note">
                {t(`gear.kind.${g.kind as 'shoe' | 'bike' | 'other'}`)}
                {g.brand || g.model ? ` · ${gearModel(g)}` : ''} ·{' '}
                {t('gear.activities', { count: g.activities })}
                {g.last_used ? ` · ${t('gear.lastUsed', { date: date(g.last_used) })}` : ''}
                {g.sports.length > 0 &&
                  ` · ${t('gear.defaultFor', { sports: g.sports.map((s) => t(`sport.${s as 'run'}`)).join(', ') })}`}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function GearForm({ gear, onDone }: { gear: GearOut | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(gear?.name ?? '');
  const [kind, setKind] = useState(gear?.kind ?? 'shoe');
  const [brand, setBrand] = useState(gear?.brand ?? '');
  const [model, setModel] = useState(gear?.model ?? '');
  const [sports, setSports] = useState<string[]>(gear?.sports ?? []);
  const [habitual, setHabitual] = useState(gear?.habitual ?? false);
  const [initial, setInitial] = useState(gear ? String(Math.round(gear.initial_m / 1000)) : '0');
  const [limit, setLimit] = useState(
    gear?.limit_m ? String(Math.round(gear.limit_m / 1000)) : gear ? '' : '800',
  );
  const save = useMutation({
    mutationFn: async (extra: { retired?: boolean; remove?: boolean } = {}) => {
      if (gear && extra.remove) {
        await api.DELETE('/api/gear/{gear_id}', { params: { path: { gear_id: gear.id } } });
        return;
      }
      const body = {
        name: name.trim(),
        kind: kind as 'shoe' | 'bike' | 'other',
        brand: brand.trim() || null,
        model: model.trim() || null,
        sports: sports as ('run' | 'ride')[],
        initial_m: Number(initial || 0) * 1000,
        limit_m: limit.trim() ? Number(limit) * 1000 : null,
        habitual,
      };
      const { error } = gear
        ? await api.PATCH('/api/gear/{gear_id}', {
            params: { path: { gear_id: gear.id } },
            body: { ...body, ...(extra.retired != null ? { retired: extra.retired } : {}) },
          })
        : await api.POST('/api/gear', { body });
      if (error) throw new Error((error as { detail?: string }).detail ?? 'error');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: gearQuery(api).queryKey });
      onDone();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({});
  };
  return (
    <form className="panel stack" onSubmit={submit}>
      <h2>{gear ? gear.name : t('gear.add')}</h2>
      <div className="fields">
        <label className="field">
          <b>{t('activity.name')}</b>
          <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <b>{t('gear.kindLabel')}</b>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="shoe">{t('gear.kind.shoe')}</option>
            <option value="bike">{t('gear.kind.bike')}</option>
            <option value="other">{t('gear.kind.other')}</option>
          </select>
        </label>
        <label className="field">
          <b>{t('gear.brand')}</b>
          <input maxLength={120} value={brand} onChange={(e) => setBrand(e.target.value)} />
        </label>
        <label className="field">
          <b>{t('gear.model')}</b>
          <input maxLength={120} value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
        <label className="field">
          <b>{t('gear.initial')}</b>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={initial}
            onChange={(e) => setInitial(e.target.value)}
          />
        </label>
        <label className="field">
          <b>{t('gear.limit')}</b>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
        </label>
      </div>
      <fieldset className="checks">
        <legend>{t('gear.defaultSports')}</legend>
        {SPORTS.filter((s) => s !== 'other').map((s) => (
          <label key={s} className="check">
            <input
              type="checkbox"
              checked={sports.includes(s)}
              onChange={(e) => setSports(e.target.checked ? [...sports, s] : sports.filter((x) => x !== s))}
            />
            {t(`sport.${s}`)}
          </label>
        ))}
      </fieldset>
      <label className="check habitualcheck">
        <input type="checkbox" checked={habitual} onChange={(e) => setHabitual(e.target.checked)} />
        <span>
          <b>{t('gear.habitual')}</b>
          <small className="note">{t('gear.habitualHelp')}</small>
        </span>
      </label>
      <div className="actions">
        <button type="submit" className="primary" disabled={save.isPending}>
          {t('settings.save')}
        </button>
        {gear && (
          <button type="button" onClick={() => save.mutate({ retired: !gear.retired })}>
            {gear.retired ? t('gear.unretire') : t('gear.retire')}
          </button>
        )}
        {gear && (
          <button
            type="button"
            onClick={() => window.confirm(t('gear.deleteConfirm')) && save.mutate({ remove: true })}
          >
            {t('gear.delete')}
          </button>
        )}
        <button type="button" className="link" onClick={onDone}>
          {t('common.cancel')}
        </button>
        {save.isError && (
          <span className="note" role="alert">
            {save.error.message}
          </span>
        )}
      </div>
    </form>
  );
}

// --- import (OS-404, OS-406) -----------------------------------------------------------------------

type Progress = { name: string; sent: number; size: number } | null;

async function uploadFile(file: File, onProgress: (sent: number) => void): Promise<ImportOut> {
  const { data, error } = await api.POST('/api/imports', { body: { filename: file.name, size: file.size } });
  if (!data || error) throw new Error((error as { detail?: string } | undefined)?.detail ?? 'error');
  const created = data as NewImport;
  const { url, token, part_size } = created.upload;
  const parts = Math.ceil(file.size / part_size);
  for (let index = 0; index < parts; index++) {
    const body = file.slice(index * part_size, Math.min(file.size, (index + 1) * part_size));
    let attempt = 0;
    for (;;) {
      try {
        const response = await fetch(`${url}/${index}?token=${encodeURIComponent(token)}`, {
          method: 'PUT',
          body,
          headers: { 'Content-Type': 'application/octet-stream' },
          credentials: 'omit',
        });
        if (!response.ok) throw new Error(String(response.status));
        break;
      } catch (failure) {
        if (++attempt >= 3) throw failure;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    onProgress(Math.min(file.size, (index + 1) * part_size));
  }
  const finished = await api.POST('/api/imports/{import_id}/finish', {
    params: { path: { import_id: created.import.id } },
  });
  if (!finished.data) throw new Error('finish');
  return finished.data;
}

/** Upload FIT, TCX, GPX or ZIP files, a Garmin export or a Strava export, and follow the imports. */
export function Import() {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<Progress>(null);
  const imports = useQuery({
    ...importsQuery(api),
    refetchInterval: (q) =>
      q.state.data?.some((i) => i.status === 'queued' || i.status === 'running') ? 3000 : false,
  });
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        setProgress({ name: file.name, sent: 0, size: file.size });
        await uploadFile(file, (sent) => setProgress({ name: file.name, sent, size: file.size }));
        void queryClient.invalidateQueries({ queryKey: importsQuery(api).queryKey });
      }
    },
    onSettled: () => {
      setProgress(null);
      void queryClient.invalidateQueries({ queryKey: importsQuery(api).queryKey });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
  });
  return (
    <section className="page">
      <h1>{t('import.title')}</h1>
      <p className="note">{t('import.help')}</p>
      <ul className="note bullets">
        <li>{t('import.strava')}</li>
        <li>{t('import.garmin')}</li>
        <li>{t('import.files')}</li>
      </ul>
      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={() => input.current?.click()}
          disabled={upload.isPending}
        >
          {t('import.choose')}
        </button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept=".zip,.fit,.tcx,.gpx,.gz,application/zip"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) upload.mutate(files);
          }}
        />
      </div>
      {progress && (
        <div className="panel" role="status">
          <p>
            {t('import.uploading', { name: progress.name })} · {megabytes(progress.sent)} /{' '}
            {megabytes(progress.size)}
          </p>
          <progress max={progress.size} value={progress.sent} />
        </div>
      )}
      {upload.isError && (
        <p className="warn" role="alert">
          {t('import.uploadError')}
        </p>
      )}
      <h2>{t('import.history')}</h2>
      {imports.data?.length === 0 && <p className="state">{t('import.none')}</p>}
      <ul className="rows imports">
        {imports.data?.map((i) => (
          <ImportRow key={i.id} item={i} />
        ))}
      </ul>
    </section>
  );
}

function ImportRow({ item: i }: { item: ImportOut }) {
  const running = i.status === 'queued' || i.status === 'running';
  return (
    <li>
      <span>
        <b>{i.filename}</b>
        <small className="note">
          {date(i.created_at)} · {megabytes(i.size)}
          {i.kind ? ` · ${t(`import.kind.${i.kind as 'strava' | 'archive' | 'file'}`)}` : ''}
        </small>
        {running && i.total > 0 && <progress max={i.total} value={i.processed} aria-label={i.filename} />}
        <small className="note">
          {t(`import.status.${i.status as 'done'}`)}
          {i.total > 0 &&
            ` · ${t('import.counts', { processed: i.processed, total: i.total, created: i.created, merged: i.merged, skipped: i.skipped, failed: i.failed })}`}
          {i.photos > 0 && ` · ${t('import.photos', { count: i.photos })}`}
        </small>
        {i.error && <small className="warn">{i.error}</small>}
        {i.errors.length > 0 && (
          <details>
            <summary>{t('import.problems', { count: i.failed })}</summary>
            <ul>
              {i.errors.map((e, n) => (
                <li key={n}>
                  <code>{e.file}</code>: {e.error}
                </li>
              ))}
            </ul>
          </details>
        )}
      </span>
      <span className={`badge ${i.status === 'done' ? 'success' : i.status === 'error' ? 'error' : ''}`}>
        {t(`import.status.${i.status as 'done'}`)}
      </span>
    </li>
  );
}

// --- export (OS-411) -------------------------------------------------------------------------------

/** "Export all your data": a ZIP with the original files, photos and JSON, ready for a few days. */
export function ExportData() {
  const queryClient = useQueryClient();
  const exports = useQuery({
    ...exportsQuery(api),
    refetchInterval: (q) =>
      q.state.data?.some((e) => e.status === 'queued' || e.status === 'running') ? 3000 : false,
  });
  const start = useMutation({
    mutationFn: async () => {
      await api.POST('/api/exports');
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: exportsQuery(api).queryKey }),
  });
  const latest: ExportOut | undefined = exports.data?.[0];
  const busy = latest?.status === 'queued' || latest?.status === 'running';
  return (
    <>
      <h2>{t('export.title')}</h2>
      <p className="note">{t('export.help')}</p>
      <div className="actions">
        <button type="button" onClick={() => start.mutate()} disabled={busy || start.isPending}>
          {t('export.start')}
        </button>
        {busy && (
          <span className="note" role="status">
            {t('export.preparing')}
          </span>
        )}
        {latest?.status === 'done' && latest.download_url && (
          <a className="button" href={latest.download_url} download>
            {t('export.download', { size: megabytes(latest.size ?? 0) })}
          </a>
        )}
        {latest?.status === 'error' && (
          <span className="warn" role="alert">
            {t('common.error')}
          </span>
        )}
      </div>
      {latest?.expires_at && latest.status === 'done' && (
        <p className="note">{t('export.until', { date: date(latest.expires_at) })}</p>
      )}
    </>
  );
}
