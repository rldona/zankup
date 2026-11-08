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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends visitors without a session to sign-in, keeping where they wanted to go', async () => {
    mockApi({ '/api/auth/me': signedOut });
    const router = renderAt('/activities/7');
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByText('Your sports data, from start to finish.')).toBeInTheDocument();
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
    renderAt('/');
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
    const router = renderAt('/');
    const months = await screen.findAllByRole('heading', { level: 2 });
    expect(months.map((h) => h.textContent)).toEqual([
      'November 20263 act. · 21 km · 2 h 3 min',
      'October 20269 act. · 98 km · 8 h 20 min',
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
    const router = renderAt('/');
    await userEvent.click(await screen.findByRole('link', { name: /Morning run/ }));
    expect(await screen.findByRole('heading', { name: 'Morning run' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/activities/7');
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
    const router = renderAt('/profile');
    expect(await screen.findByText('runner@example.com')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(calls).toContain('POST /api/auth/logout');
  });

  it('has every section in the sidebar and the tab bar', async () => {
    mockApi({
      '/api/auth/me': () => Response.json(ME),
      '/api/activities': () => Response.json({ items: [], next_cursor: null }),
    });
    const router = renderAt('/');
    const [sidebar, tabbar] = await screen.findAllByRole('navigation', { name: 'Main' });
    if (!sidebar || !tabbar) throw new Error('missing navigation');
    const names = (nav: HTMLElement) => Array.from(nav.querySelectorAll('a')).map((a) => a.textContent);
    expect(names(sidebar)).toEqual(['Activities', 'Search', 'Stats', 'Profile', 'Settings']);
    expect(names(tabbar)).toEqual(['Feed', 'Search', 'Stats', 'Sync', 'You']);
    expect(sidebar.querySelector('a.on')?.textContent).toBe('Activities');

    await userEvent.click(within(tabbar).getByRole('link', { name: 'Search' }));
    expect(await screen.findByText('Advanced search arrives with OS-219.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/search');
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
      expect(nav.querySelector('a.on')).toHaveAttribute('href', '/'); // still in the feed section
    }
  });

  it('only redirects to paths inside the app after signing in', () => {
    expect(safeNext('/activities/7')).toBe('/activities/7');
    expect(safeNext('https://evil.test')).toBe('/');
    expect(safeNext('//evil.test')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});
