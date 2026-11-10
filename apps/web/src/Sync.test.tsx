import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { routes } from './router';

const ME = { id: 1, email: 'runner@example.com', display_name: null, totp_enabled: true };

const run = (status: string, extra: object = {}) => ({
  id: 9,
  trigger: 'button',
  status,
  started_at: '2026-11-08T10:00:00Z',
  finished_at: status === 'success' ? '2026-11-08T10:01:00Z' : null,
  new_count: 2,
  progress: {
    since: '2026-11-01',
    listed: 5,
    new: 2,
    downloaded: status === 'success' ? 2 : 1,
    window: 1,
    windows: 1,
  },
  pending_imports: status === 'success' ? 0 : 1,
  error: null,
  ...extra,
});

function mockApi(handlers: Record<string, (request: Request) => Response | Promise<Response>>) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request) => {
      const url = new URL(input.url);
      calls.push(`${input.method} ${url.pathname}`);
      const handler = handlers[`${input.method} ${url.pathname}`] ?? handlers[url.pathname];
      return handler ? handler(input) : Response.json({ detail: 'Not Found' }, { status: 404 });
    }),
  );
  return calls;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<App queryClient={queryClient} router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

describe('sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('syncs from the sidebar, follows the progress and refreshes the feed', async () => {
    let state: object[] = [];
    let polls = 0;
    const calls = mockApi({
      '/api/auth/me': () => Response.json(ME),
      '/api/activities': () => Response.json({ items: [], next_cursor: null }),
      'GET /api/sync': () => {
        if (state.length && ++polls >= 1) state = [run('success')];
        return Response.json(state);
      },
      'POST /api/sync': () => {
        state = [run('running')];
        return Response.json(state[0], { status: 202 });
      },
    });
    renderAt('/activities');
    const [sidebar] = await screen.findAllByRole('button', { name: 'Sync' });
    if (!sidebar) throw new Error('no sync button');
    await userEvent.click(sidebar);
    const sheet = await screen.findByRole('dialog', { name: 'Sync' });
    expect(within(sheet).getByText('Syncing with Garmin…')).toBeInTheDocument();
    expect(sheet).toHaveTextContent('5 found · 2 new · 1 downloaded');
    expect(sheet).toHaveTextContent('1 activity still to import');
    expect(
      await within(sheet).findByText('Done: 2 new activities.', {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    await waitFor(() => expect(calls.filter((c) => c === 'GET /api/activities').length).toBeGreaterThan(1));
  });

  it('starts the whole history from the Sync screen', async () => {
    let body: unknown = null;
    mockApi({
      '/api/auth/me': () => Response.json(ME),
      'GET /api/sync': () => Response.json([]),
      'POST /api/sync': async (request) => {
        body = await request.json();
        return Response.json(run('queued', { trigger: 'initial' }), { status: 202 });
      },
    });
    renderAt('/sync');
    await userEvent.click(await screen.findByRole('button', { name: 'Load the whole history' }));
    expect(await screen.findByText('Waiting for its turn…')).toBeInTheDocument();
    expect(body).toEqual({ history: true });
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled();
  });
});
