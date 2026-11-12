import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { routes } from './router';
import { deviceName } from './signin/device';
import { toBase64url, toBytes } from './signin/webauthn';

const ME = { id: 1, email: 'runner@example.com', display_name: null, totp_enabled: true };
const signedOut = () => Response.json({ detail: 'Not signed in' }, { status: 401 });
const wrong = () => Response.json({ detail: 'Incorrect e-mail, password or code' }, { status: 401 });

type Handler = (body: Record<string, unknown>) => Response;

/** Fake API by path; records each request body. */
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

function renderSignIn(path = '/sign-in') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App queryClient={queryClient} router={router} />);
  return router;
}

async function enterPassword(email = 'runner@example.com', password = 'secret password') {
  await userEvent.type(await screen.findByLabelText('E-mail'), email);
  await userEvent.type(screen.getByLabelText('Password', { selector: 'input' }), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('sign-in', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('signs in with password and code, then goes where the visitor was heading', async () => {
    let session = false;
    const bodies = mockApi({
      '/api/auth/me': () => (session ? Response.json(ME) : signedOut()),
      '/api/auth/login': () => Response.json({ mfa_required: true, challenge: 'a.b.c' }),
      '/api/auth/login/totp': () => {
        session = true;
        return Response.json(ME);
      },
      '/api/activities/7': () => Response.json({ detail: 'Not Found' }, { status: 404 }),
    });
    const router = renderSignIn('/sign-in?next=%2Factivities%2F7');
    await enterPassword();
    expect(bodies['/api/auth/login']?.[0]).toMatchObject({
      email: 'runner@example.com',
      password: 'secret password',
      remember: true,
      client: 'web',
    });

    expect(await screen.findByRole('heading', { name: 'Two-step verification' })).toBeInTheDocument();
    const first = screen.getByLabelText('Digit 1');
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('autocomplete', 'one-time-code');
    await userEvent.keyboard('123456'); // focus advances box by box and the full code submits itself
    await waitFor(() => expect(router.state.location.pathname).toBe('/activities/7'));
    expect(bodies['/api/auth/login/totp']).toEqual([{ challenge: 'a.b.c', code: '123456' }]);
  });

  it('spreads a code autofilled into the first box', async () => {
    const bodies = mockApi({
      '/api/auth/me': signedOut,
      '/api/auth/login': () => Response.json({ mfa_required: true, challenge: 'a.b.c' }),
      '/api/auth/login/totp': wrong,
    });
    renderSignIn();
    await enterPassword();
    fireEvent.change(await screen.findByLabelText('Digit 1'), { target: { value: '147132' } });
    await waitFor(() =>
      expect(bodies['/api/auth/login/totp']).toEqual([{ challenge: 'a.b.c', code: '147132' }]),
    );
  });

  it('accepts the whole code pasted at once', async () => {
    const bodies = mockApi({
      '/api/auth/me': signedOut,
      '/api/auth/login': () => Response.json({ mfa_required: true, challenge: 'a.b.c' }),
      '/api/auth/login/totp': wrong,
    });
    renderSignIn();
    await enterPassword();
    const first = await screen.findByLabelText('Digit 1');
    fireEvent.paste(first, { clipboardData: { getData: () => '654 321' } });
    await waitFor(() =>
      expect(bodies['/api/auth/login/totp']).toEqual([{ challenge: 'a.b.c', code: '654321' }]),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect e-mail, password or code.');
    expect(screen.getByLabelText('Digit 1')).toHaveValue(''); // cleared for another try
  });

  it('never says which field was wrong, and explains rate limits', async () => {
    let calls = 0;
    mockApi({
      '/api/auth/me': signedOut,
      '/api/auth/login': () =>
        ++calls === 1
          ? wrong()
          : new Response(JSON.stringify({ detail: 'Too many' }), {
              status: 429,
              headers: { 'Retry-After': '30' },
            }),
    });
    renderSignIn();
    await enterPassword();
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect e-mail, password or code.');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Try again in 30 s.');
  });

  it('checks the form before calling the API', async () => {
    const bodies = mockApi({ '/api/auth/me': signedOut });
    renderSignIn();
    await enterPassword('not-an-email', 'x');
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid e-mail.');
    expect(bodies['/api/auth/login']).toBeUndefined();
  });

  it('shows and hides the password', async () => {
    mockApi({ '/api/auth/me': signedOut });
    renderSignIn();
    const input = await screen.findByLabelText('Password', { selector: 'input' });
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'current-password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
  });

  it('signs in with a passkey', async () => {
    let session = false;
    const bodies = mockApi({
      '/api/auth/me': () => (session ? Response.json(ME) : signedOut()),
      '/api/auth/passkeys/login/options': () =>
        Response.json({ options: { challenge: 'AQID', rpId: 'zankup.com', userVerification: 'required' } }),
      '/api/auth/passkeys/login': () => {
        session = true;
        return Response.json(ME);
      },
      '/api/activities': () => Response.json({ items: [], next_cursor: null }),
    });
    const get = vi.fn(async (options: CredentialRequestOptions) => {
      expect(Array.from(new Uint8Array(options.publicKey?.challenge as ArrayBuffer))).toEqual([1, 2, 3]);
      return {
        id: 'cred',
        rawId: new Uint8Array([9, 9]).buffer,
        type: 'public-key',
        response: {
          clientDataJSON: new Uint8Array([1]).buffer,
          authenticatorData: new Uint8Array([2]).buffer,
          signature: new Uint8Array([3]).buffer,
          userHandle: null,
        },
        getClientExtensionResults: () => ({}),
      };
    });
    vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});
    Object.defineProperty(navigator, 'credentials', { value: { get }, configurable: true });

    const router = renderSignIn();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in with a passkey' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(bodies['/api/auth/passkeys/login']?.[0]).toMatchObject({
      credential: {
        rawId: 'CQk',
        response: { clientDataJSON: 'AQ', authenticatorData: 'Ag', signature: 'Aw' },
      },
      client: 'web',
    });
  });

  it("offers Google and the passkey first, then 'or' and the e-mail, as the app (OS-918)", async () => {
    mockApi({
      '/api/auth/me': signedOut,
      '/api/setup': () => Response.json({ open: false }),
      '/api/auth/google/providers': () => Response.json({ google: true }),
    });
    vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});
    renderSignIn();
    const google = await screen.findByRole('link', { name: 'Continue with Google' });
    const passkey = screen.getByRole('button', { name: 'Sign in with a passkey' });
    const or = screen.getByText('or');
    const email = screen.getByLabelText('E-mail');
    const submit = screen.getByRole('button', { name: 'Sign in' });
    const order = [google, passkey, or, email, submit];
    for (let n = 1; n < order.length; n++)
      expect(order[n - 1]?.compareDocumentPosition(order[n] as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(submit).not.toHaveClass('primary'); // the quieter one
  });

  it('offers no development sign-in unless the API says so', async () => {
    const bodies = mockApi({
      '/api/auth/me': signedOut,
      '/api/setup': () => Response.json({ open: false }),
      '/api/auth/google/providers': () => Response.json({ google: false }),
    });
    renderSignIn();
    await screen.findByRole('heading', { name: 'Welcome back!' });
    await waitFor(() => expect(bodies['/api/auth/google/providers']).toHaveLength(1));
    await expect(
      screen.findByRole('button', { name: 'Sign in as owner (dev)' }, { timeout: 100 }),
    ).rejects.toThrow();
  });

  it('signs in with one click in development, then goes where the visitor was heading', async () => {
    let session = false;
    const bodies = mockApi({
      '/api/auth/me': () => (session ? Response.json(ME) : signedOut()),
      '/api/setup': () => Response.json({ open: false }),
      '/api/auth/google/providers': () => Response.json({ google: false, dev_login: true }),
      '/api/auth/dev-login': () => {
        session = true;
        return Response.json(ME);
      },
      '/api/activities/7': () => Response.json({ detail: 'Not Found' }, { status: 404 }),
    });
    const router = renderSignIn('/sign-in?next=%2Factivities%2F7');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in as owner (dev)' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/activities/7'));
    expect(bodies['/api/auth/dev-login']).toHaveLength(1);
    expect(bodies['/api/auth/login']).toBeUndefined();
  });

  it('explains when the development sign-in is not available', async () => {
    mockApi({
      '/api/auth/me': signedOut,
      '/api/setup': () => Response.json({ open: false }),
      '/api/auth/google/providers': () => Response.json({ google: false, dev_login: true }),
      '/api/auth/dev-login': () => Response.json({ detail: 'Not Found' }, { status: 404 }),
    });
    renderSignIn();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in as owner (dev)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The development sign-in is not available.');
  });

  it('hides the passkey option where the browser has no WebAuthn', async () => {
    mockApi({ '/api/auth/me': signedOut });
    renderSignIn();
    await screen.findByRole('heading', { name: 'Welcome back!' });
    expect(screen.queryByRole('button', { name: 'Sign in with a passkey' })).not.toBeInTheDocument();
  });

  it('sends a signed-in visitor straight on', async () => {
    mockApi({
      '/api/auth/me': () => Response.json(ME),
      '/api/activities': () => Response.json({ items: [], next_cursor: null }),
    });
    const router = renderSignIn('/sign-in?next=https%3A%2F%2Fevil.test');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});

describe('sign-in helpers', () => {
  it('converts between bytes and base64url', () => {
    expect(toBase64url(new Uint8Array([251, 255, 0]))).toBe('-_8A');
    expect(Array.from(toBytes('-_8A'))).toEqual([251, 255, 0]);
  });

  it('names the device for the sessions list', () => {
    const android =
      'Mozilla/5.0 (Linux; Android 17; SM-S948B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
    expect(deviceName(android)).toBe('Chrome on Android');
    expect(
      deviceName(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 Version/19.0 Safari/605.1.15',
      ),
    ).toBe('Safari on macOS');
  });
});
