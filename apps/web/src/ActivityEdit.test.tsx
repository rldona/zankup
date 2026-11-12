import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { routes } from './router';

const RUN = {
  id: 7,
  name: 'Morning run',
  sport: 'run',
  sub_sport: null,
  source: 'garmin',
  start_utc: '2026-11-04T07:30:00Z',
  timezone: '+01:00',
  duration_s: 3600,
  moving_s: 3500,
  distance_m: 10000,
  ascent_m: 80,
  avg_hr: 150,
  avg_power: null,
  has_gps: false,
  route: null,
  photo: null,
  photos: 0,
};

function mockApi() {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request | string, init?: RequestInit) => {
      const request =
        typeof input === 'string' ? new Request(new URL(input, 'http://localhost'), init) : input;
      const url = new URL(request.url);
      calls.push(`${request.method} ${url.pathname}`);
      if (request.method === 'DELETE') return new Response(null, { status: 204 });
      const body: Record<string, unknown> = {
        '/api/auth/me': { id: 1, email: 'me@example.com', display_name: 'Runner', totp_enabled: true },
        '/api/activities': { items: [RUN], next_cursor: null },
        '/api/activities/7': { ...RUN, laps: [], splits: [], best_efforts: [], photo_list: [] },
        '/api/gear': [],
      };
      const data = body[url.pathname];
      return data === undefined
        ? Response.json({ detail: 'Not Found' }, { status: 404 })
        : Response.json(data);
    }),
  );
  return calls;
}

describe('editing an activity (OS-909)', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  });
  afterEach(() => vi.unstubAllGlobals());

  it('deletes it after a confirmation and goes back to the feed', async () => {
    const calls = mockApi();
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(routes, { initialEntries: ['/activities/7'] });
    render(<App queryClient={queryClient} router={router} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete activity' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('cannot be undone'));
    await waitFor(() => expect(calls).toContain('DELETE /api/activities/7'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/activities'));
  });

  it('keeps it when the confirmation is cancelled', async () => {
    const calls = mockApi();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(routes, { initialEntries: ['/activities/7'] });
    render(<App queryClient={queryClient} router={router} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete activity' }));
    expect(calls).not.toContain('DELETE /api/activities/7');
    expect(router.state.location.pathname).toBe('/activities/7');
  });

  it('closes when the overlay is clicked', async () => {
    mockApi();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(routes, { initialEntries: ['/activities/7'] });
    render(<App queryClient={queryClient} router={router} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.click(await screen.findByRole('dialog'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
