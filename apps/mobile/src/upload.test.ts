import type { ApiClient } from '@zankup/core';
import { describe, expect, it, vi } from 'vitest';

import { partCount, partUrl, upload } from './upload';

describe('upload', () => {
  it('builds the part address from an absolute URL or a path', () => {
    expect(partUrl('https://api.zankup.com/api/direct/uploads/7', 'https://x', 2, 'a b')).toBe(
      'https://api.zankup.com/api/direct/uploads/7/2?token=a%20b',
    );
    expect(partUrl('/api/direct/uploads/7', 'http://localhost:8000/', 0, 't')).toBe(
      'http://localhost:8000/api/direct/uploads/7/0?token=t',
    );
  });

  it('counts parts', () => {
    expect(partCount(0, 4)).toBe(1);
    expect(partCount(8, 4)).toBe(2);
    expect(partCount(9, 4)).toBe(3);
  });

  it('sends every part, retries a failed one and finishes', async () => {
    const POST = vi.fn(async (path: string) =>
      path === '/api/imports'
        ? { data: { import: { id: 5 }, upload: { url: '/api/direct/uploads/5', token: 't', part_size: 4 } } }
        : { data: { id: 5, status: 'queued' } },
    );
    const api = { POST } as unknown as ApiClient;
    const reads: [number, number][] = [];
    const source = {
      name: 'export.zip',
      size: 10,
      read: async (offset: number, length: number) => {
        reads.push([offset, length]);
        return new Uint8Array(length);
      },
    };
    let failures = 1;
    const put = vi.fn(async () => (failures-- > 0 ? { ok: false, status: 502 } : { ok: true, status: 204 }));
    const progress: number[] = [];
    const result = await upload(
      api,
      'http://h',
      source,
      put,
      (sent) => progress.push(sent),
      async () => {},
    );
    expect(reads).toEqual([
      [0, 4],
      [4, 4],
      [8, 2],
    ]);
    expect(put).toHaveBeenCalledTimes(4); // the first part twice
    expect(progress).toEqual([4, 8, 10]);
    expect(POST).toHaveBeenLastCalledWith('/api/imports/{import_id}/finish', {
      params: { path: { import_id: 5 } },
    });
    expect(result).toEqual({ id: 5, status: 'queued' });
  });
});
