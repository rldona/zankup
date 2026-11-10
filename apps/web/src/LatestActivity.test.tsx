import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { routes } from './router';

const ME = { id: 1, email: 'me@example.com', display_name: 'Runner', totp_enabled: true };
const ride = (id: number, hoursAgo: number) => ({
  id,
  name: `Ride ${id}`,
  sport: 'ride',
  sub_sport: null,
  source: 'garmin',
  start_utc: new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString(),
  timezone: null,
  duration_s: 3600,
  moving_s: 3500,
  distance_m: 30000,
  ascent_m: 300,
  avg_hr: 140,
  avg_power: null,
  has_gps: false,
  route: null,
  photo: null,
  photos: 0,
});

function mockApi(items: unknown[]) {
  const patches: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request | string, init?: RequestInit) => {
      const request =
        typeof input === 'string' ? new Request(new URL(input, 'http://localhost'), init) : input;
      const url = new URL(request.url);
      if (request.method === 'PATCH') {
        patches.push(await request.json());
        return Response.json({});
      }
      const body: Record<string, unknown> = {
        '/api/auth/me': ME,
        '/api/activities': { items, next_cursor: null },
        '/api/activities/2': { ...ride(2, 2), photo_list: [], gear: null, description: null },
        '/api/gear': [
          { id: 5, name: 'Road bike', kind: 'bike', retired: false },
          { id: 6, name: 'Old shoes', kind: 'shoe', retired: true },
        ],
      };
      const data = body[url.pathname];
      return data === undefined
        ? Response.json({ detail: 'Not Found' }, { status: 404 })
        : Response.json(data);
    }),
  );
  return patches;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<App queryClient={queryClient} router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

describe('the latest activity on arrival (OS-906)', () => {
  beforeEach(() => {
    localStorage.clear();
    // jsdom has no modal dialogs: opening one only marks it open.
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  });
  afterEach(() => vi.unstubAllGlobals());

  it('only remembers the newest on the first visit', async () => {
    mockApi([ride(2, 2)]);
    renderAt('/');
    await waitFor(() => expect(localStorage.getItem('zankup-latest-seen')).toBe('2'));
    expect(screen.queryByRole('dialog', { name: 'Latest activity' })).not.toBeInTheDocument();
  });

  it('shows a new activity once, saves what changed and remembers it', async () => {
    localStorage.setItem('zankup-latest-seen', '1');
    const patches = mockApi([ride(2, 2), ride(1, 30)]);
    renderAt('/');
    const name = await screen.findByRole('textbox', { name: 'Name' });
    expect(name).toHaveValue('Ride 2');
    await userEvent.clear(name);
    await userEvent.type(name, 'Hill repeats');
    await userEvent.click(await screen.findByRole('radio', { name: 'Road bike' }));
    expect(screen.queryByRole('radio', { name: 'Old shoes' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(patches).toEqual([{ name: 'Hill repeats', gear_id: 5 }]));
    await waitFor(() => expect(localStorage.getItem('zankup-latest-seen')).toBe('2'));
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
  });

  it('does not show an activity older than three days', async () => {
    localStorage.setItem('zankup-latest-seen', '1');
    mockApi([ride(2, 24 * 4)]);
    renderAt('/');
    await screen.findByRole('heading', { name: 'Home' });
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
  });
});
