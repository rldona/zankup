import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { routes } from './router';

const GOAL = {
  id: 4,
  period: 'week',
  metric: 'distance',
  sport: 'run',
  target: 20000,
  current: 5000,
  projection: 17500,
  start: '2026-11-09',
  end: '2026-11-16',
};

describe('Goals (OS-911)', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('opens a goal day by day, and edits it in place', async () => {
    const calls: { method: string; path: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request | string, init?: RequestInit) => {
        const request =
          typeof input === 'string' ? new Request(new URL(input, 'http://localhost'), init) : input;
        const url = new URL(request.url);
        const body = request.method === 'GET' ? null : await request.json();
        calls.push({ method: request.method, path: url.pathname, body });
        if (request.method === 'PATCH') return Response.json(GOAL);
        if (url.pathname === '/api/auth/me')
          return Response.json({
            id: 1,
            email: 'me@example.com',
            display_name: 'Runner',
            totp_enabled: true,
          });
        if (url.pathname === '/api/goals') return Response.json([GOAL]);
        if (url.pathname === '/api/stats/calendar')
          return Response.json([
            {
              day: '2026-11-09',
              tsb: null,
              activities: [{ id: 1, sport: 'run', name: null, load: null, distance_m: 5000, moving_s: 1500 }],
            },
          ]);
        return Response.json({ detail: 'Not Found' }, { status: 404 });
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <App queryClient={queryClient} router={createMemoryRouter(routes, { initialEntries: ['/goals'] })} />,
    );

    const card = await screen.findByRole('button', { name: /This week · Run/ });
    expect(card).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(card);
    expect(card).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(calls.some((c) => c.path === '/api/stats/calendar')).toBe(true));

    await userEvent.click(screen.getByRole('button', { name: 'Edit', pressed: false }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog');
    const target = within(dialog).getByRole('textbox', { name: /Target/ });
    expect(target).toHaveValue('20');
    await userEvent.clear(target);
    await userEvent.type(target, '25');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')).toEqual({
        method: 'PATCH',
        path: '/api/goals/4',
        body: { period: 'week', metric: 'distance', sport: 'run', target: 25000 },
      }),
    );
  });

  it('keeps a chart open or folded as it was left, after leaving the page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request | string) => {
        const url = new URL(typeof input === 'string' ? input : input.url, 'http://localhost');
        if (url.pathname === '/api/auth/me')
          return Response.json({
            id: 1,
            email: 'me@example.com',
            display_name: 'Runner',
            totp_enabled: true,
          });
        if (url.pathname === '/api/goals') return Response.json([GOAL]);
        if (url.pathname === '/api/stats/calendar') return Response.json([]);
        return Response.json({ detail: 'Not Found' }, { status: 404 });
      }),
    );
    const open = () =>
      render(
        <App
          queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
          router={createMemoryRouter(routes, { initialEntries: ['/goals'] })}
        />,
      );
    const first = open();
    await userEvent.click(await screen.findByRole('button', { name: /This week · Run/ }));
    first.unmount();

    const second = open();
    const card = await screen.findByRole('button', { name: /This week · Run/ });
    expect(card).toHaveAttribute('aria-expanded', 'true'); // still open
    await userEvent.click(card);
    second.unmount();

    open();
    expect(await screen.findByRole('button', { name: /This week · Run/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});
