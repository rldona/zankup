import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { routes } from './router';

const ME = { id: 1, email: 'me@example.com', display_name: 'Runner', totp_enabled: true };
const NOTIFICATIONS = {
  activity: true,
  record: true,
  sync_error: true,
  garmin_key: true,
  estimate: false,
  import: true,
};
const SETTINGS = {
  theme: 'system',
  language: null,
  units: 'metric',
  hr_max: 190,
  hr_rest: 50,
  hr_max_estimate: 188,
  zone_model: 'max',
  lthr: null,
  ftp: null,
  privacy_zones: [{ id: 'home', name: 'Home', lat: 51.5, lon: -0.16, radius_m: 400 }],
  notifications: NOTIFICATIONS,
};
const GEAR = [
  {
    id: 1,
    kind: 'shoe',
    name: 'Old trainers',
    brand: 'Brand',
    model: 'Model',
    sports: ['run'],
    initial_m: 0,
    limit_m: 800000,
    retired: false,
    distance_m: 812000,
    activities: 90,
    moving_s: 300000,
    first_used: '2025-01-01T08:00:00Z',
    last_used: '2026-11-01T08:00:00Z',
    over_limit: true,
  },
];
const totals = (count: number, km: number) => ({
  count,
  distance_m: km * 1000,
  moving_s: count * 3600,
  ascent_m: 100 * count,
  load: 80 * count,
});

type Handler = (url: URL, request: Request) => Response | Promise<Response>;

function mockApi(extra: Record<string, Handler> = {}) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const handlers: Record<string, Handler> = {
    '/api/auth/me': () => Response.json(ME),
    '/api/settings': () => Response.json(SETTINGS),
    '/api/gear': () => Response.json(GEAR),
    '/api/imports': () => Response.json([]),
    '/api/exports': () => Response.json([]),
    '/api/sources': () => Response.json([]),
    '/api/auth/devices': () => Response.json([]),
    '/api/stats/estimates': () => Response.json([]),
    '/api/engine': () => Response.json({ running: false, done: 0, total: 0 }),
    '/api/activities': () => Response.json({ items: [], next_cursor: null }),
    '/api/activities/months': () => Response.json([]),
    ...extra,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request | string, init?: RequestInit) => {
      const request =
        typeof input === 'string' ? new Request(new URL(input, 'http://localhost'), init) : input;
      const url = new URL(request.url);
      const text = request.method === 'GET' || request.method === 'PUT' ? '' : await request.clone().text();
      calls.push({ method: request.method, path: url.pathname, body: text ? JSON.parse(text) : null });
      const handler = handlers[`${request.method} ${url.pathname}`] ?? handlers[url.pathname];
      return handler ? handler(url, request) : Response.json({ detail: 'Not Found' }, { status: 404 });
    }),
  );
  return calls;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App queryClient={queryClient} router={router} />);
  return router;
}

describe('phase 4 screens', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gear: mileage against its limit, and a warning past it', async () => {
    const calls = mockApi({
      'POST /api/gear': () => Response.json(GEAR[0], { status: 201 }),
    });
    renderAt('/gear');
    expect(await screen.findByRole('heading', { name: 'Old trainers' })).toBeInTheDocument();
    expect(screen.getByText(/Past its limit/)).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Mileage against its limit' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
    expect(screen.getByText(/90 activities/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add gear' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'New bike');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'bike');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ride' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/gear')).toBe(true));
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/gear');
    expect(post?.body).toMatchObject({ name: 'New bike', kind: 'bike', sports: ['ride'], limit_m: 800000 });
  });

  it('import: a file goes up in parts and its import is listed with its counts', async () => {
    let listed: object[] = [];
    const parts: string[] = [];
    const calls = mockApi({
      'GET /api/imports': () => Response.json(listed),
      'POST /api/imports': () =>
        Response.json(
          {
            import: { id: 5 },
            upload: { url: 'http://api.example.com/api/direct/uploads/5', token: 'tok', part_size: 4 },
          },
          { status: 201 },
        ),
      'PUT /api/direct/uploads/5/0': (url) => {
        parts.push(url.searchParams.get('token') ?? '');
        return new Response(null, { status: 204 });
      },
      'PUT /api/direct/uploads/5/1': () => new Response(null, { status: 204 }),
      'POST /api/imports/5/finish': () => {
        listed = [
          {
            id: 5,
            kind: 'strava',
            status: 'done',
            filename: 'export.zip',
            size: 6,
            received: 6,
            total: 1816,
            processed: 1816,
            created: 1609,
            merged: 207,
            skipped: 0,
            failed: 1,
            photos: 108,
            errors: [{ file: 'activities/1.gpx', error: 'The GPX file has no times' }],
            error: null,
            created_at: '2026-11-09T09:00:00Z',
            finished_at: '2026-11-09T09:30:00Z',
          },
        ];
        return Response.json(listed[0]);
      },
    });
    renderAt('/settings/import');
    expect(await screen.findByRole('heading', { name: 'Import' })).toBeInTheDocument();
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    await userEvent.upload(input, new File(['abcdef'], 'export.zip', { type: 'application/zip' }));
    expect(await screen.findByText(/1609 new · 207 merged/)).toBeInTheDocument();
    expect(parts).toEqual(['tok']);
    expect(calls.find((c) => c.path === '/api/imports' && c.method === 'POST')?.body).toEqual({
      filename: 'export.zip',
      size: 6,
    });
    expect(screen.getByText(/108 photos/)).toBeInTheDocument();
    expect(screen.getByText('1 file could not be read')).toBeInTheDocument();
  });

  it('settings: notifications per kind and the privacy zones', async () => {
    const calls = mockApi({
      'PATCH /api/settings': async (_url, request) =>
        Response.json({ ...SETTINGS, ...((await request.json()) as object) }),
    });
    renderAt('/settings');
    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByText(/cannot receive notifications/)).toBeInTheDocument(); // no push in jsdom
    await userEvent.click(screen.getByRole('checkbox', { name: /Estimates going up/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      notifications: { ...NOTIFICATIONS, estimate: true },
    });
    const zones = screen.getByRole('heading', { name: 'Privacy zones' }).closest('section');
    if (!zones) throw new Error('no privacy zones section');
    expect(within(zones).getByText('Home')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toEqual({ privacy_zones: [] }),
    );
    expect(screen.getByRole('link', { name: 'Gear' })).toHaveAttribute('href', '/gear');
    expect(screen.getByRole('button', { name: 'Prepare export' })).toBeInTheDocument();
  });

  it('a shared activity opens without a session and shows no private place', async () => {
    mockApi({
      '/api/auth/me': () => Response.json({ detail: 'Not signed in' }, { status: 401 }),
      '/api/settings': () => Response.json({ detail: 'Not signed in' }, { status: 401 }),
      '/api/public/shares/abc': () =>
        Response.json({
          name: 'Sunday long run',
          sport: 'run',
          sub_sport: null,
          day: '2026-11-08',
          athlete: 'Runner',
          duration_s: 5400,
          moving_s: 5300,
          distance_m: 18000,
          ascent_m: 120,
          avg_hr: 145,
          avg_power: null,
          route: [
            [
              [51.5, -0.1],
              [51.51, -0.11],
            ],
          ],
          profile: [
            { distance_m: 0, altitude_m: 10, speed: 3 },
            { distance_m: 18000, altitude_m: 30, speed: 3 },
          ],
          splits: [],
          photos: [],
          expires_at: '2026-11-15T09:00:00Z',
        }),
    });
    renderAt('/s/abc');
    expect(await screen.findByRole('heading', { name: 'Sunday long run' })).toBeInTheDocument();
    expect(screen.getByText('18.00 km')).toBeInTheDocument();
    expect(screen.getByText(/Parts of the route near private places are hidden/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Route' })).toBeInTheDocument();
  });

  it('an expired link says so', async () => {
    mockApi({ '/api/public/shares/old': () => Response.json({ detail: 'gone' }, { status: 404 }) });
    renderAt('/s/old');
    expect(await screen.findByText('This link has expired or does not exist.')).toBeInTheDocument();
  });

  it('a month in review: totals against the month before, records and gear', async () => {
    mockApi({
      '/api/stats/review': (url) => {
        expect(url.searchParams.get('value')).toBe('2026-10');
        return Response.json({
          period: 'month',
          start: '2026-10-01',
          end: '2026-11-01',
          totals: totals(20, 200),
          previous: totals(10, 100),
          by_sport: { run: totals(20, 200) },
          active_days: 18,
          longest_streak: 6,
          longest: {
            id: 9,
            name: 'Half marathon',
            sport: 'run',
            day: '2026-10-19',
            distance_m: 21100,
            moving_s: 6300,
            ascent_m: 80,
            load: 210,
          },
          hardest: null,
          hilliest: null,
          records: [
            {
              distance_key: 'half_marathon',
              time_s: 6300,
              activity_id: 9,
              day: '2026-10-19',
              previous_s: 6500,
            },
          ],
          gear: [{ id: 1, name: 'Old trainers', kind: 'shoe', distance_m: 200000, count: 20 }],
          buckets: Array.from({ length: 31 }, (_, i) => ({
            start: `2026-10-${String(i + 1).padStart(2, '0')}`,
            distance_m: i % 2 ? 10000 : 0,
            moving_s: 3600,
            count: i % 2,
          })),
          photos: 0,
        });
      },
    });
    renderAt('/review/month/2026-10');
    expect(await screen.findByRole('heading', { name: /October 2026 in review/ })).toBeInTheDocument();
    await screen.findAllByText('Half marathon');
    expect(screen.getAllByText(/\+100 % vs\. before/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Half marathon' })[0]).toHaveAttribute(
      'href',
      '/activities/9',
    );
    expect(screen.getByText(/beat 1:48:20/)).toBeInTheDocument();
    expect(screen.getAllByText('Old trainers').length).toBeGreaterThan(0);
    expect(screen.getByText('18')).toBeInTheDocument(); // active days
    expect(screen.getByRole('link', { name: /September 2026/ })).toHaveAttribute(
      'href',
      '/review/month/2026-09',
    );
  });
});
