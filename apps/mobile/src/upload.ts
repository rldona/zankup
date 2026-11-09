/**
 * Uploading an import from the phone (OS-515), in parts as the PWA does (OS-404): each part goes to
 * `{url}/{index}` with the upload's token, retried up to three times, then the import is finished.
 */
import type { ApiClient, ImportOut, NewImport } from '@zankup/core';

/** Where a part goes: the API gives an absolute URL, or a path when API_PUBLIC_URL is unset. */
export function partUrl(base: string, instance: string, index: number, token: string): string {
  const root = /^https?:\/\//i.test(base) ? base : `${instance.replace(/\/+$/, '')}${base}`;
  return `${root}/${index}?token=${encodeURIComponent(token)}`;
}

/** How many parts a file of `size` bytes takes, at least one. */
export const partCount = (size: number, partSize: number) => Math.max(1, Math.ceil(size / partSize));

export type Source = {
  name: string;
  size: number;
  /** Reads `length` bytes from `offset`. */
  read: (offset: number, length: number) => Promise<Uint8Array<ArrayBuffer>>;
};

type Put = (url: string, body: Uint8Array<ArrayBuffer>) => Promise<{ ok: boolean; status: number }>;

export async function upload(
  api: ApiClient,
  instance: string,
  source: Source,
  put: Put,
  onProgress: (sent: number) => void,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<ImportOut> {
  const { data, error } = await api.POST('/api/imports', {
    body: { filename: source.name, size: source.size },
  });
  if (!data || error) throw new Error((error as { detail?: string } | undefined)?.detail ?? 'error');
  const created = data as NewImport;
  const { url, token, part_size } = created.upload;
  const parts = partCount(source.size, part_size);
  for (let index = 0; index < parts; index++) {
    const offset = index * part_size;
    const body = await source.read(offset, Math.min(part_size, source.size - offset));
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await put(partUrl(url, instance, index, token), body);
        if (!response.ok) throw new Error(String(response.status));
        break;
      } catch (failure) {
        if (attempt >= 3) throw failure;
        await wait(1000 * attempt);
      }
    }
    onProgress(Math.min(source.size, offset + part_size));
  }
  const finished = await api.POST('/api/imports/{import_id}/finish', {
    params: { path: { import_id: created.import.id } },
  });
  if (!finished.data) throw new Error('finish');
  return finished.data;
}
