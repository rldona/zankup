import { QueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { safeNext } from './next';
import { routes } from './router';

const HEALTH = { status: 'ok', version: '0.1.0', database: 'ok', schema_revision: 'abc' };
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
    mockApi({ '/api/auth/me': signedOut, '/api/health': () => Response.json(HEALTH) });
    const router = renderAt('/activities/7');
    expect(await screen.findByText('API connected · v0.1.0')).toBeInTheDocument();
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
    expect(screen.getByText('runner@example.com')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Older ride')).toBeInTheDocument();
    expect(calls).toContain('GET /api/activities?limit=30&cursor=abc');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
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
      '/api/health': () => Response.json(HEALTH),
    });
    const router = renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('API connected · v0.1.0')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(calls).toContain('POST /api/auth/logout');
  });

  it('only redirects to paths inside the app after signing in', () => {
    expect(safeNext('/activities/7')).toBe('/activities/7');
    expect(safeNext('https://evil.test')).toBe('/');
    expect(safeNext('//evil.test')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});
