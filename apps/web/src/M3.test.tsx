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
};
const totals = (count: number, km: number) => ({
  count,
  distance_m: km * 1000,
  moving_s: count * 3600,
  ascent_m: 100 * count,
  load: 80 * count,
});
const ESTIMATES = [
  {
    kind: 'ftp',
    value: 192.3,
    method: 'ftp_20min',
    day: '2026-11-08',
    sources: [{ id: 3, name: 'ROUVY', sport: 'ride', day: '2026-10-11' }],
    history: [
      { day: '2026-10-01', value: 185 },
      { day: '2026-11-08', value: 192.3 },
    ],
  },
  {
    kind: 'critical_speed',
    value: 3.09,
    method: 'critical_speed',
    day: '2026-11-08',
    sources: [],
    history: [{ day: '2026-11-08', value: 3.09 }],
  },
  { kind: 'race_10k', value: 3211, method: 'riegel:10', day: '2026-11-08', sources: [], history: [] },
];

type Handler = (url: URL, request: Request) => Response | Promise<Response>;

function mockApi(extra: Record<string, Handler> = {}) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const handlers: Record<string, Handler> = {
    '/api/auth/me': () => Response.json(ME),
    '/api/settings': () => Response.json(SETTINGS),
    '/api/stats/years': () => Response.json([2026, 2025]),
    '/api/stats/fitness': () =>
      Response.json(
        Array.from({ length: 30 }, (_, i) => ({
          day: `2026-10-${String(i + 1).padStart(2, '0')}`,
          load: 50,
          ctl: 40 + i / 10,
          atl: 30,
          tsb: 8,
        })),
      ),
    '/api/stats/summary': () =>
      Response.json({
        current: totals(10, 100),
        previous: totals(5, 40),
        by_sport: { run: totals(10, 100) },
      }),
    '/api/stats/volume': () =>
      Response.json([{ start: '2026-10-01', totals: totals(3, 30), by_sport: { run: totals(3, 30) } }]),
    '/api/stats/curves': () =>
      Response.json([
        { duration_s: 60, value: 4.2, activity_id: 7, day: '2026-10-05' },
        { duration_s: 1200, value: 3.3, activity_id: 7, day: '2026-10-05' },
      ]),
    '/api/stats/records': () =>
      Response.json({
        all_time: [{ distance_key: '5k', distance_m: 5000, time_s: 1500, activity_id: 7, day: '2026-10-05' }],
        period: [{ distance_key: '5k', distance_m: 5000, time_s: 1500, activity_id: 7, day: '2026-10-05' }],
        progression: {
          '5k': [
            { distance_key: '5k', distance_m: 5000, time_s: 1600, activity_id: 6, day: '2026-01-05' },
            { distance_key: '5k', distance_m: 5000, time_s: 1500, activity_id: 7, day: '2026-10-05' },
          ],
        },
      }),
    '/api/stats/estimates': () => Response.json(ESTIMATES),
    '/api/stats/progress': () =>
      Response.json([
        { year: 2025, cumulative_m: [0, 5000, 9000] },
        { year: 2026, cumulative_m: [0, 6000] },
      ]),
    '/api/stats/efficiency': () => Response.json([]),
    '/api/week': () =>
      Response.json({
        today: '2026-11-09',
        days: [],
        this_week: { week_start: '2026-11-09', count: 0, distance_m: 0, moving_s: 0, ascent_m: 0 },
        previous: [],
        streak_weeks: 3,
        records: [],
      }),
    '/api/goals': () => Response.json([]),
    '/api/events': () =>
      Response.json([
        {
          id: 1,
          kind: 'record',
          payload: { activity_id: 7, distance_key: '5k', time_s: 1500 },
          created_at: '2026-10-05T10:00:00Z',
        },
      ]),
    '/api/engine': () =>
      Response.json({
        running: true,
        reason: 'x',
        done: 12,
        total: 207,
        computed: 12,
        activities: 207,
        metrics_version: 2,
      }),
    ...extra,
  };
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
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App queryClient={queryClient} router={router} />);
  return router;
}

describe('phase 3 screens', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('stats: now, summary against last year, records and a period in the URL', async () => {
    mockApi();
    const router = renderAt('/stats');
    expect(await screen.findByText('Recomputing your metrics: 12 of 207 activities.')).toBeInTheDocument();
    expect((await screen.findAllByText('+100 %')).length).toBeGreaterThan(0);
    expect(screen.getByText('+150 %')).toBeInTheDocument(); // 100 km against 40
    expect(await screen.findByRole('heading', { name: 'How the 5 km record came down' })).toBeInTheDocument();
    // The period as on the app (OS-912): a year moved with arrows, or a run of months.
    const year = new Date().getFullYear();
    await userEvent.click(screen.getByRole('radio', { name: 'Year' }));
    expect(router.state.location.search).toBe(`?period=${year}`);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: 'Months' }));
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    expect(router.state.location.search).toBe(`?period=${year}-${month}`);
    // Estimates have their own page now (OS-913).
    expect(screen.queryByText(/Riegel's formula/)).not.toBeInTheDocument();
  });

  it('notifications: the bell on Home opens what the engine noticed (OS-916)', async () => {
    mockApi();
    const router = renderAt('/');
    const header = within(await screen.findByRole('main'));
    await userEvent.click(await header.findByRole('link', { name: 'Notifications' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/notifications'));
    expect(await screen.findByText('New 5 km record: 25:00')).toBeInTheDocument();
  });

  it("goals: add one from Goals (You's old Goals tab leads there)", async () => {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    let goals: object[] = [];
    const calls = mockApi({
      'GET /api/goals': () => Response.json(goals),
      'POST /api/goals': async (_url, request) => {
        const body = (await request.json()) as { target: number };
        goals = [
          {
            id: 1,
            period: 'week',
            metric: 'distance',
            sport: null,
            target: body.target,
            start: '2026-11-09',
            end: '2026-11-16',
            current: 10000,
            projection: 70000,
          },
        ];
        return Response.json(goals[0], { status: 201 });
      },
      '/api/profile/summary': () =>
        Response.json({
          year: 2026,
          this_year: [],
          all_time: [],
          since: null,
          records: [],
          streak_weeks: 0,
          device: null,
        }),
    });
    const router = renderAt('/profile?tab=goals');
    await waitFor(() => expect(router.state.location.pathname).toBe('/goals'));
    await userEvent.click(await screen.findByRole('button', { name: 'Add goal' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Target/ }), '40');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add goal' }));
    expect(await screen.findByText('On track: about 70.00 km by the end')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      period: 'week',
      metric: 'distance',
      sport: null,
      target: 40000,
    });
  });

  it('calendar: bubbles per activity, form per day and the week totals', async () => {
    mockApi({
      '/api/stats/calendar': () =>
        Response.json(
          Array.from({ length: 35 }, (_, i) => {
            const d = new Date(2026, 9, 26 + i);
            const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            return {
              day,
              tsb: i === 10 ? -5 : null,
              activities:
                i === 10
                  ? [{ id: 9, sport: 'run', name: 'Tempo', load: 90, distance_m: 10000, moving_s: 3000 }]
                  : [],
            };
          }),
        ),
    });
    renderAt('/stats/calendar?month=2026-11');
    expect(await screen.findByRole('link', { name: 'Tempo · 50:00' })).toHaveAttribute(
      'href',
      '/activities/9',
    );
    expect(screen.getByText('-5')).toBeInTheDocument();
    expect(screen.getAllByText(/1 · 10.00 km · 50 min/).length).toBe(1);
  });

  it('routes and segments lists', async () => {
    mockApi({
      '/api/routes': () =>
        Response.json([
          {
            id: 4,
            sport: 'run',
            name: 'River loop',
            route: null,
            count: 3,
            best: {
              id: 5,
              name: 'River loop',
              day: '2026-10-01',
              moving_s: 1500,
              distance_m: 5000,
              avg_hr: 150,
            },
            latest: {
              id: 6,
              name: 'River loop',
              day: '2026-11-01',
              moving_s: 1600,
              distance_m: 5000,
              avg_hr: 148,
            },
          },
        ]),
      '/api/segments': () =>
        Response.json([
          { id: 2, name: 'The hill', track: '', distance_m: 800, ascent_m: 40, efforts: 4, best_s: 230 },
        ]),
    });
    renderAt('/routes');
    expect(await screen.findByText(/3 times/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /River loop/ })).toHaveAttribute('href', '/routes/4');
  });

  it('settings: the zone model recomputes, with the estimates as hints', async () => {
    const calls = mockApi({
      'PATCH /api/settings': async (_url, request) =>
        Response.json({ ...SETTINGS, ...((await request.json()) as object) }),
      '/api/sources': () => Response.json([]),
      '/api/auth/devices': () => Response.json([]),
      '/api/stats/estimates': () =>
        Response.json([
          ...ESTIMATES,
          { kind: 'lthr', value: 161, method: 'lthr_60min', day: '2026-11-08', sources: [], history: [] },
        ]),
    });
    renderAt('/settings/heart');
    const model = await screen.findByRole('combobox', { name: 'Heart rate zones' });
    expect(screen.getByText('Estimated: 161 bpm')).toBeInTheDocument();
    expect(screen.getByText('Estimated: 192 W')).toBeInTheDocument();
    await userEvent.selectOptions(model, 'reserve');
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PATCH',
        path: '/api/settings',
        body: { zone_model: 'reserve' },
      }),
    );
    const status = await screen.findAllByRole('status');
    expect(within(status[0] as HTMLElement).getByText(/Recomputing/)).toBeInTheDocument();
  });
});
