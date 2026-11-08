import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { routes } from './router';

const RUN = {
  id: 7,
  name: 'Rodaje por la sierra',
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

describe('advanced search', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the search in the URL, shows a summary and removes filters with one tap', async () => {
    const asked: URLSearchParams[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request) => {
        const url = new URL(input.url);
        if (url.pathname === '/api/auth/me')
          return Response.json({ id: 1, email: 'me@example.com', display_name: null, totp_enabled: true });
        if (url.pathname === '/api/activities/search') {
          asked.push(url.searchParams);
          return Response.json({
            items: [RUN],
            totals: { count: 1, distance_m: 6000, moving_s: 1750, ascent_m: 40 },
            next_offset: null,
          });
        }
        return Response.json({ detail: 'Not Found' }, { status: 404 });
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(routes, { initialEntries: ['/search?sport=run&dmin=5&gps=1'] });
    render(<App queryClient={queryClient} router={router} />);

    expect(await screen.findByText('1 activity · 6.00 km · 29 min · 40 m')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Rodaje por la sierra/ })).toHaveAttribute(
      'href',
      '/activities/7',
    );
    const last = asked.at(-1);
    expect(last?.getAll('sport')).toEqual(['run']);
    expect(last?.get('min_distance')).toBe('5000');
    expect(last?.get('with_gps')).toBe('true');

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'sierra');
    await waitFor(() => expect(router.state.location.search).toContain('q=sierra'));
    await waitFor(() => expect(asked.at(-1)?.get('q')).toBe('sierra'));

    const active = document.querySelector('.chips.active');
    if (!(active instanceof HTMLElement)) throw new Error('no active filters');
    await userEvent.click(within(active).getByRole('button', { name: /Remove filter ≥ 5 km/ }));
    expect(router.state.location.search).not.toContain('dmin');
    const [sortBy] = screen.getAllByRole('combobox', { name: /Sort by/ });
    if (!sortBy) throw new Error('no sort');
    await userEvent.selectOptions(sortBy, 'distance');
    expect(router.state.location.search).toContain('sort=distance');
  });
});
