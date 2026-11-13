import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { routes } from './router';

describe('Estimates (OS-913)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("has its own page, which You's old Estimates tab leads to", async () => {
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
        if (url.pathname === '/api/stats/estimates')
          return Response.json([
            { kind: 'ftp', value: 192, method: 'ftp_20min', sources: [], history: [] },
            { kind: 'race_10k', value: 3211, method: 'riegel', sources: [], history: [] },
          ]);
        return Response.json({ detail: 'Not Found' }, { status: 404 });
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(routes, { initialEntries: ['/profile?tab=estimates'] });
    render(<App queryClient={queryClient} router={router} />);
    await waitFor(() => expect(router.state.location.pathname).toBe('/estimates'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Estimates' })).toBeInTheDocument();
    expect(await screen.findByText('192 W')).toBeInTheDocument();
    expect(screen.getByText('53:31')).toBeInTheDocument(); // the 10 km prediction
  });

  it('says how much each estimate moved in three months, and opens its history', async () => {
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
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
        if (url.pathname === '/api/stats/estimates')
          return Response.json([
            {
              kind: 'ftp',
              value: 192,
              method: 'ftp_20min',
              day: ago(10),
              sources: [{ id: 7, day: ago(10) }],
              // 183 W before the three months, 192 W now: +9 W.
              history: [
                { day: ago(200), value: 170 },
                { day: ago(120), value: 183 },
                { day: ago(40), value: 188 },
                { day: ago(10), value: 192 },
              ],
            },
            {
              kind: 'race_10k',
              value: 3211,
              method: 'riegel',
              day: ago(10),
              sources: [],
              // Faster by 1:14 in the three months: good news, with a minus.
              history: [
                { day: ago(150), value: 3285 },
                { day: ago(10), value: 3211 },
              ],
            },
          ]);
        return Response.json({ detail: 'Not Found' }, { status: 404 });
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(routes, { initialEntries: ['/estimates'] });
    render(<App queryClient={queryClient} router={router} />);
    const ftp = await screen.findByRole('button', { name: /FTP/ });
    expect(ftp).toHaveTextContent('+9 W in 3 months');
    expect(within(ftp).getByText('+9 W in 3 months')).toHaveClass('delta', 'good');
    expect(screen.getByRole('button', { name: /10 km/ })).toHaveTextContent('\u22121:14 in 3 months');
    // The card opens its history, with the activities behind it.
    await userEvent.click(ftp);
    expect(ftp).toHaveAttribute('aria-expanded', 'true');
    const detail = screen.getByRole('region', { name: 'FTP' });
    expect(within(detail).getByRole('link')).toHaveAttribute('href', '/activities/7');
  });
});
