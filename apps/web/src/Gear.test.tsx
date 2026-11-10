import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { routes } from './router';

const gear = (id: number, name: string, extra: object = {}) => ({
  id,
  name,
  kind: 'shoe',
  brand: null,
  model: null,
  sports: ['run'],
  initial_m: 0,
  limit_m: null,
  distance_m: 100000,
  activities: 10,
  last_used: null,
  retired: false,
  over_limit: false,
  habitual: false,
  ...extra,
});

describe('gear: the habitual one (OS-910)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists it first with its badge, and the form marks another as habitual', async () => {
    const patches: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request | string, init?: RequestInit) => {
        const request =
          typeof input === 'string' ? new Request(new URL(input, 'http://localhost'), init) : input;
        const url = new URL(request.url);
        if (request.method === 'PATCH') {
          patches.push(await request.json());
          return Response.json({});
        }
        if (url.pathname === '/api/auth/me')
          return Response.json({
            id: 1,
            email: 'me@example.com',
            display_name: 'Runner',
            totp_enabled: true,
          });
        if (url.pathname === '/api/gear')
          return Response.json([
            gear(1, 'Old pair', { retired: true }),
            gear(2, 'Daily trainers'),
            gear(3, 'Race shoes', { habitual: true }),
          ]);
        return Response.json({ detail: 'Not Found' }, { status: 404 });
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <App queryClient={queryClient} router={createMemoryRouter(routes, { initialEntries: ['/gear'] })} />,
    );
    const names = await screen.findAllByRole('heading', { level: 2 });
    expect(names.map((h) => h.textContent)).toEqual([
      'Race shoesHabitual',
      'Daily trainers',
      'Old pairRetired',
    ]);

    const daily = names[1]?.closest('li');
    if (!daily) throw new Error('no card');
    await userEvent.click(within(daily).getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Habitual/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches).toEqual([expect.objectContaining({ habitual: true })]));
  });
});
