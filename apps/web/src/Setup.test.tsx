import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { routes } from './router';
import { passwordStrength } from '@zankup/core';

const ME = { id: 1, email: 'me@example.com', display_name: 'Raúl', totp_enabled: true };
const CODES = [
  'abcde-fghjk',
  'mnpqr-stuvw',
  'xyz23-45678',
  '9abcd-efghj',
  'kmnpq-rstuv',
  'wxyz2-34567',
  '89abc-defgh',
  'jkmnp-qrstu',
];
const signedOut = () => Response.json({ detail: 'Not signed in' }, { status: 401 });

type Handler = (body: Record<string, unknown>) => Response;

function mockApi(handlers: Record<string, Handler>) {
  const bodies: Record<string, Record<string, unknown>[]> = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request) => {
      const path = new URL(input.url).pathname;
      const text = await input.clone().text();
      const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      (bodies[path] ??= []).push(body);
      const handler = handlers[path];
      return handler ? handler(body) : Response.json({ detail: 'Not Found' }, { status: 404 });
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

async function fillAccount(code = 'ABCD-EFGH-JKMN') {
  await userEvent.type(await screen.findByLabelText('Setup code', { exact: false }), code);
  await userEvent.type(screen.getByLabelText('Your name'), 'Raúl');
  await userEvent.type(screen.getByLabelText('E-mail'), 'me@example.com');
  await userEvent.type(screen.getByLabelText(/^Password/), 'a long and unique passphrase');
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('sign-up', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates the account: code and password, QR and code, recovery codes, all set', async () => {
    let session = false;
    const bodies = mockApi({
      '/api/setup': () => Response.json({ open: !session }),
      '/api/auth/me': () => (session ? Response.json(ME) : signedOut()),
      '/api/setup/account': () =>
        Response.json({
          setup_token: 'tok',
          secret: 'JBSWY3DPEHPK3PXP',
          uri: 'otpauth://totp/x',
          qr_svg: '<svg data-qr="1"></svg>',
        }),
      '/api/setup/totp': () => {
        session = true;
        return Response.json({ me: ME, recovery_codes: CODES });
      },
      '/api/activities': () => Response.json({ items: [], next_cursor: null }),
    });
    const router = renderAt('/setup');
    await fillAccount();
    expect(bodies['/api/setup/account']?.[0]).toEqual({
      code: 'ABCD-EFGH-JKMN',
      display_name: 'Raúl',
      email: 'me@example.com',
      password: 'a long and unique passphrase',
      accept: true,
    });

    expect(await screen.findByRole('heading', { name: 'Two-step verification' })).toBeInTheDocument();
    expect(document.querySelector('.qr svg[data-qr]')).not.toBeNull();
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    await userEvent.keyboard('123456');

    expect(await screen.findByRole('heading', { name: 'Recovery codes' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    const next = screen.getByRole('button', { name: 'Continue' });
    expect(next).toBeDisabled(); // only once they are saved
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(next);

    await userEvent.click(await screen.findByRole('button', { name: 'Go to your activities' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(bodies['/api/setup/totp']).toEqual([
      { setup_token: 'tok', code: '123456', client: 'web', device_name: 'Browser' },
    ]);
  });

  it('explains a wrong setup code and where to find it', async () => {
    mockApi({
      '/api/setup': () => Response.json({ open: true }),
      '/api/setup/account': () => Response.json({ detail: 'That setup code is not right' }, { status: 401 }),
    });
    renderAt('/setup');
    expect(await screen.findByText(/server logs/)).toBeInTheDocument();
    await fillAccount('WRONG');
    expect(await screen.findByRole('alert')).toHaveTextContent('That setup code is not right. Copy it again');
  });

  it("shows the server's reason, such as a breached password", async () => {
    mockApi({
      '/api/setup': () => Response.json({ open: true }),
      '/api/setup/account': () =>
        Response.json(
          { detail: 'This password appears in known data breaches: choose another one' },
          { status: 422 },
        ),
    });
    renderAt('/setup');
    await fillAccount();
    expect(await screen.findByRole('alert')).toHaveTextContent('known data breaches');
  });

  it('says sign-up is closed once the instance has its account', async () => {
    mockApi({ '/api/setup': () => Response.json({ open: false }) });
    renderAt('/setup');
    expect(await screen.findByRole('heading', { name: 'Sign-up is closed' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign-in' })).toHaveAttribute('href', '/sign-in');
  });

  it('sends visitors of a brand-new instance from sign-in to sign-up', async () => {
    mockApi({ '/api/setup': () => Response.json({ open: true }), '/api/auth/me': signedOut });
    const router = renderAt('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/setup'));
    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
  });

  it('rates passwords for the meter', () => {
    expect(passwordStrength('short')).toBe(0);
    expect(passwordStrength('twelve chars')).toBe(1);
    expect(passwordStrength('Sixteen-chars-1x')).toBe(3);
    expect(passwordStrength('a much longer passphrase with 4 parts!')).toBe(4);
  });
});
