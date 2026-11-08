import { QueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { routes } from './router';

function mockApi(handlers: Record<string, (request: Request) => Response | Promise<Response>>) {
  const bodies: Record<string, unknown> = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request) => {
      const url = new URL(input.url);
      if (input.method !== 'GET') bodies[url.pathname] = await input.clone().json();
      const handler = handlers[url.pathname];
      return handler ? handler(input) : Response.json({ detail: 'Not signed in' }, { status: 401 });
    }),
  );
  return bodies;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App queryClient={queryClient} router={router} />);
  return router;
}

describe('password recovery and Google', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks for a link without saying whether the account exists', async () => {
    const bodies = mockApi({
      '/api/setup': () => Response.json({ open: false }),
      '/api/auth/password/forgot': () => new Response(null, { status: 202 }),
    });
    const router = renderAt('/sign-in');
    await userEvent.click(await screen.findByRole('link', { name: 'Forgot it?' }));
    expect(router.state.location.pathname).toBe('/forgot');
    await userEvent.type(screen.getByLabelText('E-mail'), 'me@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send link' }));
    expect(await screen.findByRole('status')).toHaveTextContent('If that e-mail has an account');
    expect(bodies['/api/auth/password/forgot']).toEqual({ email: 'me@example.com' });
  });

  it('sets a new password with the link and a code', async () => {
    const bodies = mockApi({
      '/api/auth/password/reset': async (request) => {
        const body = (await request.clone().json()) as { code: string };
        return body.code === '123456'
          ? new Response(null, { status: 204 })
          : Response.json({ detail: 'That code does not match' }, { status: 401 });
      },
    });
    renderAt('/reset-password?token=abc');
    await userEvent.type(screen.getByLabelText(/^Password/), 'a brand new long passphrase');
    await userEvent.type(screen.getByLabelText('Code from the app or a recovery code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('That code does not match')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Code from the app or a recovery code'));
    await userEvent.type(screen.getByLabelText('Code from the app or a recovery code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Password changed');
    expect(bodies['/api/auth/password/reset']).toEqual({
      token: 'abc',
      password: 'a brand new long passphrase',
      code: '123456',
    });
  });

  it('offers Google when the instance has it, and explains a rejected account', async () => {
    mockApi({
      '/api/setup': () => Response.json({ open: false }),
      '/api/auth/google/providers': () => Response.json({ google: true }),
    });
    renderAt('/sign-in?error=google&next=%2Factivities%2F7');
    const google = await screen.findByRole('link', { name: 'Continue with Google' });
    expect(google).toHaveAttribute('href', '/api/auth/google/start?mode=login&next=%2Factivities%2F7');
    expect(screen.getByText(/That Google account is not linked/)).toBeInTheDocument();
  });
});
