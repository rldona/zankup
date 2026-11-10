import { QueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { routes } from './router';

const ME = { id: 1, email: 'me@example.com', display_name: 'Runner', totp_enabled: true, weight_kg: 70 };
const DAY = 24 * 60 * 60 * 1000;
const at = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();
const isoDay = (daysAgo: number) => {
  const d = new Date(Date.now() - daysAgo * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** The machine's UTC offset on that date, as the API gives it: "+01:00". */
const offset = (date: Date) => {
  const minutes = -date.getTimezoneOffset();
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
};
const activity = (id: number, name: string, daysAgo: number) => ({
  id,
  name,
  sport: 'run',
  sub_sport: null,
  source: 'garmin',
  start_utc: at(daysAgo),
  // The machine's own offset, as "today" is: with none, the day would be UTC's (wrong after midnight).
  timezone: offset(new Date(Date.now() - daysAgo * DAY)),
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
});

function mockApi(items: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request | string) => {
      const url = new URL(typeof input === 'string' ? input : input.url, 'http://localhost');
      const body: Record<string, unknown> = {
        '/api/auth/me': ME,
        '/api/settings': { theme: 'system', units: 'metric', notifications: {} },
        '/api/activities': { items, next_cursor: null },
        '/api/wellness/days': [{ day: isoDay(0), steps: { value: 4321, source: 'garmin' } }],
        '/api/stats/estimates': [{ kind: 'ftp', value: 280 }],
        '/api/stats/fitness': [{ day: isoDay(0), ctl: 49, atl: 36, tsb: 13 }],
      };
      const data = body[url.pathname];
      return data === undefined
        ? Response.json({ detail: 'Not Found' }, { status: 404 })
        : Response.json(data);
    }),
  );
}

function renderHome() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<App queryClient={queryClient} router={createMemoryRouter(routes, { initialEntries: ['/'] })} />);
}

describe('Home (OS-904)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows today's activities, the day's health, the last seven days and the metrics", async () => {
    mockApi([activity(2, 'Evening run', 0), activity(1, 'Morning run', 0)]);
    renderHome();
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Evening run/ })).toHaveAttribute('href', '/activities/2');
    expect(screen.getByRole('link', { name: /Morning run/ })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Last 7 days' })).toBeInTheDocument();
    expect(screen.getByText('Run · 2')).toBeInTheDocument();
    expect(await screen.findByText('4 W/kg')).toBeInTheDocument(); // 280 W at 70 kg
    expect(await screen.findByText('Fresh')).toBeInTheDocument();
  });

  it('leaves out a last day older than yesterday, but keeps the health card', async () => {
    mockApi([activity(1, 'Old run', 3)]);
    renderHome();
    expect(await screen.findByText('4,321')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Today' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Yesterday' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Old run/ })).not.toBeInTheDocument();
  });
});
