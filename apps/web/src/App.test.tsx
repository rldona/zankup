import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { safeNext } from './next';
import { routes } from './router';

const ME = { id: 1, email: 'runner@example.com', display_name: null, totp_enabled: true };
const RUN = {
  id: 7,
  name: 'Morning run',
  sport: 'run',
  sub_sport: null,
  source: 'garmin',
  start_utc: '2026-11-07T08:00:00Z',
  timezone: '+01:00',
  duration_s: 1800,
  moving_s: 1750,
  distance_m: 6000,
  ascent_m: 40,
  avg_hr: 150,
  avg_power: null,
  has_gps: true,
  route: null,
};

type Handler = (url: URL, request: Request) => Response;

/** Fake API: answers by path, 404 for anything else. Returns the paths it was asked for. */
function mockApi(handlers: Record<string, Handler>) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request) => {
      const url = new URL(input.url);
      calls.push(`${input.method} ${url.pathname}${url.search}`);
      const handler = handlers[url.pathname];
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

const signedOut = () => Response.json({ detail: 'Not signed in' }, { status: 401 });

describe('app skeleton', () => {
  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends visitors without a session to sign-in, keeping where they wanted to go', async () => {
    mockApi({ '/api/auth/me': signedOut });
    const router = renderAt('/activities/7');
    expect(await screen.findByRole('heading', { name: 'Welcome back!' })).toBeInTheDocument();
    expect(screen.getByText('Your sports and health data together.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(router.state.location.search).toBe('?next=%2Factivities%2F7');
  });

  it('shows the feed to a signed-in user and loads more pages with the cursor', async () => {
    const calls = mockApi({
      '/api/auth/me': () => Response.json(ME),
      '/api/activities': (url) =>
        url.searchParams.get('cursor')
          ? Response.json({
              items: [{ ...RUN, id: 6, name: 'Older ride', sport: 'ride' }],
              next_cursor: null,
            })
          : Response.json({ items: [RUN], next_cursor: 'abc' }),
    });
    renderAt('/activities');
    expect(await screen.findByText('Morning run')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Older ride')).toBeInTheDocument();
    expect(calls).toContain('GET /api/activities?limit=30&cursor=abc');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('groups the feed by month with whole-month totals and filters by sport', async () => {
    const calls = mockApi({
      '/api/auth/me': () => Response.json(ME),
      '/api/activities/months': (url) =>
        Response.json(
          url.searchParams.get('sport') === 'ride'
            ? [{ month: '2026-10', count: 1, distance_m: 40000, moving_s: 5400, ascent_m: 300 }]
            : [
                { month: '2026-11', count: 3, distance_m: 21400, moving_s: 7380, ascent_m: 120 },
                { month: '2026-10', count: 9, distance_m: 98000, moving_s: 30000, ascent_m: 900 },
              ],
        ),
      '/api/activities': (url) =>
        Response.json({
          items:
            url.searchParams.get('sport') === 'ride'
              ? [{ ...RUN, id: 5, name: 'Long ride', sport: 'ride', start_utc: '2026-10-12T07:00:00Z' }]
              : [
                  RUN,
                  // 23:30 UTC on 31 October is November in its own time zone (+01:00)
                  { ...RUN, id: 6, name: 'Late run', start_utc: '2026-10-31T23:30:00Z' },
                  { ...RUN, id: 5, name: 'Long ride', sport: 'ride', start_utc: '2026-10-12T07:00:00Z' },
                ],
          next_cursor: null,
        }),
    });
    const router = renderAt('/activities');
    const months = await screen.findAllByRole('heading', { level: 2 });
    expect(months.map((h) => h.textContent)).toEqual([
      'November 20263 activities · 21 km · 2 h 3 min',
      'October 20269 activities · 98 km · 8 h 20 min',
    ]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Activities · 12 since 2026');
    const run = screen.getByRole('link', { name: /Morning run/ });
    expect(run).toHaveTextContent('6.00 km');
    expect(run).toHaveTextContent('4:52 /km'); // 6 km in 29:10 moving
    expect(screen.getByRole('link', { name: /Long ride/ })).toHaveTextContent('km/h');

    await userEvent.click(screen.getByRole('button', { name: 'Ride' }));
    await waitFor(() => expect(screen.queryByText('Morning run')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Ride' })).toHaveAttribute('aria-pressed', 'true');
    expect(router.state.location.search).toBe('?sport=ride');
    expect(calls).toContain('GET /api/activities?limit=30&sport=ride');
    expect(calls).toContain('GET /api/activities/months?sport=ride');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Activities · 12 since 2026');
    expect(screen.getByRole('link', { name: /Long ride/ })).toHaveAttribute(
      'href',
      '/activities/5?sport=ride',
    );
  });

  it('opens an activity from the feed', async () => {
    mockApi({
      '/api/auth/me': () => Response.json(ME),
      '/api/activities': () => Response.json({ items: [RUN], next_cursor: null }),
      '/api/activities/7': () => Response.json({ ...RUN, laps: [], splits: [], best_efforts: [] }),
    });
    const router = renderAt('/activities');
    await userEvent.click(await screen.findByRole('link', { name: /Morning run/ }));
    expect(await screen.findByRole('heading', { name: 'Morning run' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/activities/7');
  });

  it('shows the detail: figures, route, zones, best efforts, laps and the file', async () => {
    const n = 61;
    const streams = {
      t: Array.from({ length: n }, (_, i) => i * 10),
      dist: Array.from({ length: n }, (_, i) => i * 30),
      alt: Array.from({ length: n }, (_, i) => 100 + i),
      hr: Array.from({ length: n }, (_, i) => (i < 30 ? 120 : 170)),
      lat: Array.from({ length: n }, (_, i) => 40 + i * 0.0001),
      lon: Array.from({ length: n }, () => -3.7),
    };
    mockApi({
      '/api/auth/me': () => Response.json(ME),
      '/api/settings': () =>
        Response.json({
          theme: 'system',
          language: 'en',
          units: 'metric',
          hr_max: 190,
          hr_rest: null,
          hr_max_estimate: 188,
        }),
      '/api/activities': () => Response.json({ items: [RUN], next_cursor: null }),
      '/api/activities/7': () =>
        Response.json({
          ...RUN,
          max_hr: 171,
          device: 'fēnix 6X Pro',
          has_fit: true,
          streams: { series: ['t', 'dist', 'alt', 'hr', 'lat', 'lon'], sample_count: n },
          laps: [
            {
              idx: 0,
              start_utc: RUN.start_utc,
              duration_s: 900,
              distance_m: 3000,
              avg_hr: 130,
              max_hr: 140,
              avg_power: null,
              ascent_m: 20,
              descent_m: 5,
            },
            {
              idx: 1,
              start_utc: RUN.start_utc,
              duration_s: 850,
              distance_m: 3000,
              avg_hr: 160,
              max_hr: 171,
              avg_power: null,
              ascent_m: 20,
              descent_m: 15,
            },
          ],
          splits: [],
          best_efforts: [
            { distance_key: '5k', distance_m: 5000, time_s: 1450, start_s: 0, start_distance_m: 0 },
          ],
        }),
      '/api/activities/7/streams': () => Response.json(streams),
    });
    renderAt('/activities/7');
    const detail = await screen.findByRole('article');
    const kpis = within(detail);
    expect(await kpis.findByRole('heading', { name: 'Morning run' })).toBeInTheDocument();
    expect(detail).toHaveTextContent('fēnix 6X Pro');
    expect(kpis.getByText('6.00 km').previousElementSibling).toHaveTextContent('Distance');
    expect(kpis.getAllByText('171 bpm')).toHaveLength(2); // the figures, and the heart rate chart's footer

    // One card per chart, each with its own footer (OS-907).
    const hr = kpis.getByRole('heading', { name: 'Heart rate' }).closest('article');
    expect(hr).toHaveTextContent('Maximum171 bpm');
    expect(kpis.getByRole('heading', { name: 'Pace' })).toBeInTheDocument();
    expect(kpis.getByRole('heading', { name: 'Altitude' }).closest('article')).toHaveTextContent('Ascent');

    // Without WebGL (jsdom), the route's shape stands in for the map.
    expect(await kpis.findByText(/The map needs WebGL/)).toBeInTheDocument();
    // What the route is coloured by lives in the map's options, on the map (OS-908).
    await userEvent.click(kpis.getByRole('button', { name: 'Map options' }));
    expect(kpis.getByRole('group', { name: 'Colour by' })).toHaveTextContent('PaceHeart rateAltitude');
    expect(kpis.getByRole('group', { name: 'Replay speed' })).toHaveTextContent('10×30×100×');

    const zones = kpis.getByRole('heading', { name: 'Heart rate zones' }).closest('section');
    expect(zones).toHaveTextContent('Z2114–132 bpm5:00'); // 120 bpm, 300 s
    expect(zones).toHaveTextContent('Z4152–170 bpm5:00'); // 170 bpm, 300 s
    expect(kpis.getByRole('row', { name: /5 km 24:10 4:50 \/km/ })).toBeInTheDocument();
    expect(kpis.getByRole('heading', { name: 'Laps' }).closest('section')).toHaveTextContent(
      '3.00 km15:005:00 /km',
    );
    expect(kpis.getByRole('link', { name: 'Download file' })).toHaveAttribute(
      'href',
      '/api/activities/7/fit',
    );
  });

  it("says when an activity does not exist or is someone else's", async () => {
    mockApi({ '/api/auth/me': () => Response.json(ME) });
    renderAt('/activities/999');
    expect(await screen.findByText('This activity does not exist or is not yours.')).toBeInTheDocument();
  });

  it('has a not-found page inside the app', async () => {
    mockApi({ '/api/auth/me': () => Response.json(ME) });
    renderAt('/nowhere');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('signs out and goes back to sign-in', async () => {
    let session = true;
    const calls = mockApi({
      '/api/auth/me': () => (session ? Response.json(ME) : signedOut()),
      '/api/auth/logout': () => {
        session = false;
        return new Response(null, { status: 204 });
      },
      '/api/activities': () => Response.json({ items: [], next_cursor: null }),
    });
    const router = renderAt('/profile?tab=account');
    expect(await screen.findByText('runner@example.com', { selector: 'b' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back!' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(calls).toContain('POST /api/auth/logout');
  });

  it('has every section in the rail and the tab bar', async () => {
    mockApi({
      '/api/auth/me': () => Response.json(ME),
      '/api/activities': () => Response.json({ items: [], next_cursor: null }),
    });
    const router = renderAt('/');
    const [sidebar, tabbar] = await screen.findAllByRole('navigation', { name: 'Main' });
    if (!sidebar || !tabbar) throw new Error('missing navigation');
    const names = (nav: HTMLElement) => Array.from(nav.querySelectorAll('a')).map((a) => a.textContent);
    // The app's tabs (OS-903), on both.
    expect(names(sidebar)).toEqual(['Home', 'Feed', 'Health', 'Goals', 'You']);
    expect(names(tabbar)).toEqual(names(sidebar));
    expect(sidebar.querySelector('a.on')?.textContent).toBe('Home');
    // The rail's foot has the notifications and Settings (and the Coach when there is a model), not
    // a sync button: that is in the Activities header, as in the app.
    const rail = sidebar.closest('aside');
    if (!rail) throw new Error('missing rail');
    expect(within(rail).getByRole('link', { name: 'Notifications' })).toHaveAttribute(
      'href',
      '/notifications',
    );
    expect(within(rail).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    expect(within(rail).queryByRole('link', { name: 'Coach' })).not.toBeInTheDocument();
    expect(within(rail).queryByRole('button', { name: 'Sync' })).not.toBeInTheDocument();

    await userEvent.click(within(tabbar).getByRole('link', { name: 'Feed' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/activities'));
    // Search is reached from the Activities header, and stays under Activities.
    await userEvent.click(await screen.findByRole('link', { name: 'Search' }));
    expect(await screen.findByRole('searchbox', { name: 'Search' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/search');
    expect(sidebar.querySelector('a.on')?.textContent).toBe('Feed');

    // Settings marks its own icon in the rail; the tab bar keeps You marked, as on the app.
    await userEvent.click(within(rail).getByRole('link', { name: 'Settings' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    expect(within(rail).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    expect(sidebar.querySelector('a.on')).toBeNull();
    expect(tabbar.querySelector('a.on')?.textContent).toBe('You');
  });

  it('shows the way back to You above the screens under it', async () => {
    mockApi({ '/api/auth/me': () => Response.json(ME) });
    const router = renderAt('/stats');
    const back = await screen.findByRole('link', { name: 'You', current: false });
    expect(back).toHaveClass('crumb');
    await userEvent.click(back);
    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'));
    expect(document.querySelector('.crumb')).toBeNull();
  });

  it('keeps the feed beside the detail on wide screens', async () => {
    mockApi({
      '/api/auth/me': () => Response.json(ME),
      '/api/activities': () => Response.json({ items: [RUN], next_cursor: null }),
      '/api/activities/7': () => Response.json({ ...RUN, laps: [], splits: [], best_efforts: [] }),
    });
    renderAt('/activities/7');
    expect(await screen.findByRole('heading', { name: 'Morning run' })).toBeInTheDocument();
    const item = screen.getByRole('link', { name: /Morning run/ });
    expect(item).toHaveClass('on'); // the open activity is marked in the list
    expect(document.querySelector('.feedwrap')).toHaveClass('detail'); // mobile shows only the detail
    for (const nav of screen.getAllByRole('navigation', { name: 'Main' })) {
      expect(nav.querySelector('a.on')).toHaveAttribute('href', '/activities'); // still in Activities
    }
  });

  it('picks a theme, applies it at once and saves it in the account', async () => {
    let saved = 'system';
    const calls = mockApi({
      '/api/auth/me': () => Response.json(ME),
      '/api/settings': (_url, request) => {
        if (request.method === 'PATCH') saved = 'ocean';
        return Response.json({ theme: saved });
      },
    });
    renderAt('/settings/general');
    const ocean = await screen.findByRole('button', { name: 'Ocean' });
    expect(screen.getByRole('button', { name: /System/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(ocean);
    expect(document.documentElement.dataset.theme).toBe('ocean');
    expect(localStorage.getItem('zankup-theme')).toBe('ocean');
    expect(ocean).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(calls).toContain('PATCH /api/settings'));

    await userEvent.click(screen.getByRole('button', { name: /System/ }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('zankup-theme')).toBeNull();
  });

  it('follows the theme saved in the account from another device', async () => {
    localStorage.setItem('zankup-theme', 'light');
    mockApi({
      '/api/auth/me': () => Response.json(ME),
      '/api/settings': () => Response.json({ theme: 'oled' }),
      '/api/activities': () => Response.json({ items: [], next_cursor: null }),
    });
    renderAt('/');
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('oled'));
    expect(localStorage.getItem('zankup-theme')).toBe('oled');
  });

  it('only redirects to paths inside the app after signing in', () => {
    expect(safeNext('/activities/7')).toBe('/activities/7');
    expect(safeNext('https://evil.test')).toBe('/');
    expect(safeNext('//evil.test')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});
