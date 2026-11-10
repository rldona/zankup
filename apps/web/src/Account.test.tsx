import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { routes } from './router';

const ME = {
  id: 1,
  email: 'runner@example.com',
  display_name: 'Runner',
  totp_enabled: true,
  location: 'Madrid',
  birth_date: '1985-04-02',
  sex: 'male',
  weight_kg: 72.5,
  height_cm: 178,
};
const SETTINGS = {
  theme: 'system',
  language: null,
  units: 'metric',
  hr_max: null,
  hr_rest: null,
  hr_max_estimate: 188,
};

type Handler = (url: URL, request: Request) => Response | Promise<Response>;

function mockApi(handlers: Record<string, Handler>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request) => {
      const url = new URL(input.url);
      const text = input.method === 'GET' ? '' : await input.clone().text();
      calls.push({ method: input.method, path: url.pathname, body: text ? JSON.parse(text) : null });
      const handler = handlers[`${input.method} ${url.pathname}`] ?? handlers[url.pathname];
      return handler ? handler(url, input) : Response.json({ detail: 'Not Found' }, { status: 404 });
    }),
  );
  return calls;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<App queryClient={queryClient} router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

describe('settings and profile', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('saves language, units and heart rate, and closes other sessions', async () => {
    let settings = { ...SETTINGS };
    let devices = [
      {
        id: 1,
        name: 'Chrome on Linux',
        platform: 'web',
        created_at: '2026-11-01T10:00:00Z',
        last_seen: '2026-11-08T10:00:00Z',
        expires_at: null,
        current: true,
      },
      {
        id: 2,
        name: 'Pixel',
        platform: 'android',
        created_at: '2026-10-01T10:00:00Z',
        last_seen: '2026-11-07T10:00:00Z',
        expires_at: null,
        current: false,
      },
    ];
    const calls = mockApi({
      '/api/auth/me': () => Response.json(ME),
      'GET /api/settings': () => Response.json(settings),
      'PATCH /api/settings': async (_url, request) => {
        settings = { ...settings, ...((await request.json()) as object) };
        return Response.json(settings);
      },
      '/api/sources': () =>
        Response.json([
          {
            kind: 'garmin',
            configured: true,
            key_expires_on: '2026-11-15',
            expiring_soon: true,
            token_expires_at: null,
            last_sync_at: null,
            last_error: null,
          },
        ]),
      'GET /api/auth/devices': () => Response.json(devices),
      'DELETE /api/auth/devices/2': () => {
        devices = devices.filter((d) => d.id !== 2);
        return new Response(null, { status: 204 });
      },
    });
    renderAt('/settings/general');

    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Units' }), 'imperial');
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'PATCH', path: '/api/settings', body: { units: 'imperial' } }),
    );

    await userEvent.click(screen.getByRole('link', { name: /^Heart rate and zones/ }));
    const max = await screen.findByRole('spinbutton', { name: 'Max HR' });
    expect(max).toHaveAttribute('placeholder', '188');
    expect(screen.getByText(/the highest you have recorded \(188 bpm\)/)).toBeInTheDocument();
    await userEvent.type(max, '191');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PATCH',
        path: '/api/settings',
        body: { hr_max: 191, hr_rest: null },
      }),
    );

    await userEvent.click(screen.getByRole('link', { name: /^Account/ }));
    expect(await screen.findByText(/Renew it soon/)).toBeInTheDocument();
    const pixel = (await screen.findByText('Pixel')).closest('li');
    if (!pixel) throw new Error('no session row');
    expect(screen.getByText('This device')).toBeInTheDocument();
    await userEvent.click(within(pixel).getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(screen.queryByText('Pixel')).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('link', { name: /^General/ }));
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: /^Language/ }), 'es');
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'PATCH', path: '/api/settings', body: { language: 'es' } }),
    );
    expect(localStorage.getItem('zankup-language')).toBe('es');
  });

  it('shows the profile summary and edits the profile', async () => {
    const calls = mockApi({
      'GET /api/auth/me': () => Response.json(ME),
      'PATCH /api/auth/me': async (_url, request) =>
        Response.json({ ...ME, ...((await request.json()) as object) }),
      '/api/settings': () => Response.json(SETTINGS),
      '/api/goals': () => Response.json([]),
      '/api/profile/summary': () =>
        Response.json({
          year: 2026,
          this_year: [
            { sport: 'run', count: 120, distance_m: 1_000_000, moving_s: 360_000, ascent_m: 8000 },
            { sport: 'ride', count: 1, distance_m: 40_000, moving_s: 5400, ascent_m: 300 },
          ],
          all_time: [
            { sport: 'run', count: 900, distance_m: 8_000_000, moving_s: 3_000_000, ascent_m: 60_000 },
          ],
          since: '2012-03-04T08:00:00Z',
          records: [
            {
              distance_key: '10k',
              distance_m: 10000,
              time_s: 2700,
              activity_id: 42,
              date: '2025-04-06T08:00:00Z',
            },
          ],
          streak_weeks: 12,
          device: 'fēnix 6X Pro',
        }),
    });
    renderAt('/profile');
    expect(await screen.findByRole('heading', { name: 'Runner' })).toBeInTheDocument();
    expect(await screen.findByText('Madrid')).toBeInTheDocument();
    expect(screen.queryByText(/fēnix 6X Pro/)).not.toBeInTheDocument();
    expect(screen.getByText('12 weeks in a row')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '2026 so far' })).toBeInTheDocument();
    expect(screen.getByText('121')).toBeInTheDocument(); // activities this year
    expect(screen.getByText('120 activities')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Apr.*2025/ })).toHaveAttribute('href', '/activities/42');
    expect(screen.getByRole('row', { name: /10 km 45:00 4:30 \/km/ })).toBeInTheDocument();
    expect(screen.getByText('72.5')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Edit profile' }));
    const location = screen.getByRole('textbox', { name: 'Location' });
    await userEvent.clear(location);
    await userEvent.type(location, 'Valencia');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Valencia')).toBeInTheDocument();
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toMatchObject({ location: 'Valencia', sex: 'male', weight_kg: 72.5, height_cm: 178 });

    // You leads to the rest, as on the app (OS-914).
    expect(screen.getByRole('link', { name: /Estimates/ })).toHaveAttribute('href', '/estimates');
    expect(screen.getByRole('link', { name: /Account/ })).toHaveAttribute('href', '/settings/account');
  });

  it('lists and removes passkeys in the account tab', async () => {
    let passkeys = [
      {
        id: 3,
        name: 'Chrome on Android',
        created_at: '2026-11-01T10:00:00Z',
        last_used_at: null,
        backed_up: true,
      },
    ];
    const calls = mockApi({
      '/api/auth/me': () => Response.json(ME),
      '/api/settings': () => Response.json(SETTINGS),
      'GET /api/auth/passkeys': () => Response.json(passkeys),
      'DELETE /api/auth/passkeys/3': () => {
        passkeys = [];
        return new Response(null, { status: 204 });
      },
    });
    renderAt('/profile?tab=account');
    const row = (await screen.findByText('Chrome on Android')).closest('li');
    if (!row) throw new Error('no passkey row');
    expect(row).toHaveTextContent('not used yet');
    await userEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('No passkeys yet.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/auth/passkeys/3')).toBe(true);
  });
});
