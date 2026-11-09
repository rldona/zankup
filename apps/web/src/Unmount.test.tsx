import { QueryClient } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { routes } from './router';

const n = 61;
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

describe('leaving an activity', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not crash when the profile chart goes away', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request) => {
        const path = new URL(input.url).pathname;
        if (path === '/api/auth/me')
          return Response.json({ id: 1, email: 'me@example.com', display_name: null, totp_enabled: true });
        if (path === '/api/activities') return Response.json({ items: [RUN], next_cursor: null });
        if (path === '/api/activities/7')
          return Response.json({
            ...RUN,
            laps: [],
            splits: [],
            best_efforts: [],
            sets: [],
            streams: { series: ['t', 'dist', 'hr'], sample_count: n },
          });
        if (path === '/api/activities/7/streams')
          return Response.json({
            t: Array.from({ length: n }, (_, i) => i * 10),
            dist: Array.from({ length: n }, (_, i) => i * 30),
            hr: Array.from({ length: n }, () => 140),
          });
        return Response.json({ detail: 'Not Found' }, { status: 404 });
      }),
    );
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(routes, { initialEntries: ['/activities/7'] });
    render(<App queryClient={queryClient} router={router} />);
    await waitFor(() => expect(document.querySelector('.profile svg')).not.toBeNull(), { timeout: 4000 });

    await act(() => router.navigate('/settings'));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByText(/Unexpected Application Error/)).not.toBeInTheDocument();
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/reading 'off'/);
    errors.mockRestore();
  });
});
