import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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
});
