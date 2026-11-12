import { QueryClient } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function mockApi(items: unknown[], extra: Record<string, unknown> = {}) {
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
        ...extra,
      };
      // As the API: health days stop before `end` (exclusive), so asking up to today leaves today out.
      if (url.pathname === '/api/wellness/days' && (url.searchParams.get('end') ?? '') <= isoDay(0))
        return Response.json([]);
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

  it("draws This week as the app's: the sport, a dot for a second one, the day's number, the usual week", async () => {
    const week = (moving_s: number) => ({
      week_start: isoDay(7),
      count: 3,
      distance_m: 30000,
      moving_s,
      ascent_m: 200,
    });
    mockApi([], {
      '/api/week': {
        today: isoDay(0),
        days: [
          {
            date: isoDay(1),
            activities: [
              { id: 7, sport: 'run', name: 'Morning run' },
              { id: 8, sport: 'ride', name: 'Hill ride' },
            ],
          },
          { date: isoDay(0), activities: [] },
          { date: isoDay(-1), activities: [] },
        ],
        this_week: week(5400),
        previous: [week(10800), week(10800)],
        streak_weeks: 0,
        records: [],
      },
    });
    renderHome();
    const card = (await screen.findByRole('heading', { name: 'This week' })).closest('section');
    if (!card) throw new Error('no week card');
    // Yesterday: the run's icon in its circle, a dot for the ride, and both named.
    const done = within(card).getByRole('link', { name: /Morning run, Hill ride/ });
    expect(done).toHaveAttribute('href', '/activities/7');
    expect(done.querySelector('.second')).toHaveStyle({ '--sport': 'var(--ride)' });
    // Today and tomorrow: the day's number, today ringed and tomorrow faded.
    const today = card.querySelector('li.today');
    expect(today).toHaveTextContent(String(new Date().getDate()));
    expect(today).toHaveTextContent('Today');
    expect(card.querySelector('li.future .dot')).toHaveTextContent(
      String(new Date(Date.now() + DAY).getDate()),
    );
    // No streak to show; half a usual week of training time.
    expect(within(card).queryByText(/in a row/)).not.toBeInTheDocument();
    expect(within(card).getByRole('progressbar', { name: 'Training time' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
    expect(within(card).getByText(/50\s?%/)).toBeInTheDocument();
  });

  it("pages through the day's activities with dots below when there are several", async () => {
    mockApi([activity(2, 'Evening run', 0), activity(1, 'Morning run', 0)]);
    renderHome();
    const dots = await screen.findAllByRole('button', { name: /^Activity \d of 2$/ });
    expect(dots).toHaveLength(2);
    expect(dots[0]).toHaveAttribute('aria-current', 'true');
    expect(dots[1]).not.toHaveAttribute('aria-current');
    await userEvent.click(dots[1] as HTMLElement);
    expect(dots[1]).toHaveAttribute('aria-current', 'true');
    expect(dots[0]).not.toHaveAttribute('aria-current');
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
