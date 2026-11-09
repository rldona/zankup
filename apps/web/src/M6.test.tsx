import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { routes } from './router';

const ME = { id: 1, email: 'me@example.com', display_name: 'Runner', totp_enabled: true };
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
  privacy_zones: [],
  notifications: {},
};
const night = (day: string, source: string, others: string[] = []) => ({
  source,
  start_utc: `${day}T00:00:00Z`,
  end_utc: `${day}T07:30:00Z`,
  utc_offset_s: 3600,
  asleep_s: 7 * 3600,
  awake_s: 1800,
  light_s: 4 * 3600,
  deep_s: 3600,
  rem_s: 2 * 3600,
  score: 86,
  others,
});
const value = (v: number, source: string, others: string[] = []) => ({ value: v, source, others });
const DAYS = [
  {
    day: '2026-11-07',
    sleep: night('2026-11-07', 'garmin'),
    resting_hr: value(51, 'garmin'),
    hrv: value(45, 'garmin'),
    spo2: null,
    respiration: null,
    steps: value(9000, 'garmin'),
    tsb: -4,
    readiness: { score: 61, hrv: 55, resting_hr: 60, sleep: 86, form: 54 },
  },
  {
    day: '2026-11-08',
    sleep: night('2026-11-08', 'google_health', ['garmin']),
    resting_hr: value(49, 'garmin', ['google_health']),
    hrv: value(58, 'google_health', ['garmin']),
    spo2: value(96, 'google_health'),
    respiration: null,
    steps: value(10500, 'google_health'),
    tsb: 2,
    readiness: { score: 74, hrv: 80, resting_hr: 65, sleep: 86, form: 63 },
  },
];
const NIGHT = {
  day: '2026-11-08',
  chosen: night('2026-11-08', 'google_health', ['garmin']),
  stages: [
    { offset_s: 0, duration_s: 1800, stage: 'awake' },
    { offset_s: 1800, duration_s: 3600, stage: 'deep' },
    { offset_s: 5400, duration_s: 7200, stage: 'light' },
  ],
  alternatives: [night('2026-11-08', 'garmin')],
};
const status = (source: string, extra: object = {}) => ({
  source,
  available: true,
  connected: true,
  needs_reconnect: false,
  missing: [],
  last_sync_at: '2026-11-09T07:00:00Z',
  nights: 10,
  days: 12,
  ...extra,
});
const HEALTH_SETTINGS = {
  sources: [
    status('garmin'),
    // Disconnected, but what it synced before is still there: it can still be preferred.
    status('google_health', { connected: false, nights: 5, days: 5 }),
    status('health_connect', { connected: false, nights: 0, days: 0, last_sync_at: null }),
  ],
  priority: { sleep: [], resting_hr: [], hrv: [], spo2: [], respiration: [], steps: [] },
};

type Handler = (url: URL, request: Request) => Response | Promise<Response>;

function mockApi(extra: Record<string, Handler> = {}) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const handlers: Record<string, Handler> = {
    '/api/auth/me': () => Response.json(ME),
    '/api/settings': () => Response.json(SETTINGS),
    '/api/sources': () => Response.json([]),
    '/api/auth/devices': () => Response.json([]),
    '/api/imports': () => Response.json([]),
    '/api/exports': () => Response.json([]),
    '/api/wellness/days': () => Response.json(DAYS),
    '/api/wellness/nights/2026-11-08': () => Response.json(NIGHT),
    '/api/wellness/settings': () => Response.json(HEALTH_SETTINGS),
    ...extra,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request | string, init?: RequestInit) => {
      const request =
        typeof input === 'string' ? new Request(new URL(input, 'http://localhost'), init) : input;
      const url = new URL(request.url);
      const text = request.method === 'GET' ? '' : await request.clone().text();
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

describe('phase 6: health', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows last night with its stages, today and where each figure comes from', async () => {
    mockApi();
    renderAt('/health');
    expect(await screen.findByRole('heading', { name: 'Last night' })).toBeInTheDocument();
    expect(screen.getAllByText(/November 8/).length).toBeGreaterThan(0);
    // The source is a mark in the corner, named in full for screen readers.
    expect(
      screen.getAllByRole('img', { name: /From Google Health · also recorded by Garmin/ })[0],
    ).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Sleep stages through the night' })).toBeInTheDocument();
    expect(screen.getByText('86')).toBeInTheDocument();
    const readiness = screen.getByRole('heading', { name: 'Readiness' }).closest('article');
    expect(readiness && within(readiness).getByText('74')).toBeInTheDocument();
    const hrv = screen.getByRole('heading', { name: 'HRV' }).closest('article');
    expect(hrv && within(hrv).getByText('58 ms')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Readiness and form' })).toBeInTheDocument();
  });

  it('without data, it points to connecting a source', async () => {
    mockApi({ '/api/wellness/days': () => Response.json([]) });
    renderAt('/health');
    expect(await screen.findByText(/No health data yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Connect a source/ })).toHaveAttribute(
      'href',
      '/settings#health',
    );
  });

  it('fetch now queues a sync', async () => {
    const calls = mockApi({
      'POST /api/wellness/sync': () => Response.json({ queued: ['garmin'] }, { status: 202 }),
    });
    renderAt('/health');
    await userEvent.click(await screen.findByRole('button', { name: 'Fetch now' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/api/wellness/sync')).toBe(true),
    );
  });

  it('settings: connect Google Health, choose a source per metric and delete one source’s data', async () => {
    const calls = mockApi({
      'PUT /api/wellness/priority': () =>
        Response.json({ ...HEALTH_SETTINGS, priority: { ...HEALTH_SETTINGS.priority, sleep: ['garmin'] } }),
      'DELETE /api/wellness/sources/garmin/data': () => new Response(null, { status: 204 }),
    });
    vi.stubGlobal('confirm', () => true);
    renderAt('/settings?health=connected');
    expect(await screen.findByRole('heading', { name: 'Health' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Google Health is connected');
    expect(screen.getByRole('link', { name: 'Connect Google Health' })).toHaveAttribute(
      'href',
      '/api/wellness/google/start',
    );
    expect(screen.getByText(/10 nights, 12 days/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sleep' }), 'garmin');
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ priority: { sleep: ['garmin'] } }),
    );
    const [garminDelete] = screen.getAllByRole('button', { name: 'Delete its data' }); // Garmin's row is first
    if (garminDelete) await userEvent.click(garminDelete);
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/wellness/sources/garmin/data')).toBe(
        true,
      ),
    );
  });
});
