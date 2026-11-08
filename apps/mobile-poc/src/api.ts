/**
 * Session for the proof of concept: the app sign-in of OS-110 (password, then TOTP), with the access
 * token refreshed on a 401 and the refresh token kept in the Android keystore (expo-secure-store).
 */
import { createApiClient, type ApiClient } from '@opensport/core';
import * as SecureStore from 'expo-secure-store';

const KEY = 'opensport.session';

export type Session = { baseUrl: string; accessToken: string; refreshToken: string };

export async function loadSession(): Promise<Session | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

async function saveSession(session: Session | null): Promise<void> {
  if (session) await SecureStore.setItemAsync(KEY, JSON.stringify(session));
  else await SecureStore.deleteItemAsync(KEY);
}

export class SignInError extends Error {}

export async function signIn(baseUrl: string, email: string, password: string, code: string): Promise<Session> {
  const api = createApiClient(baseUrl);
  const step1 = await api.POST('/api/auth/login', {
    body: { email, password, client: 'android', device_name: 'OpenSport PoC', remember: false },
  });
  if (!step1.data) throw new SignInError(detail(step1.error) ?? 'Sign-in failed');
  const step2 = await api.POST('/api/auth/login/totp', { body: { challenge: step1.data.challenge, code } });
  const tokens = step2.data;
  if (!tokens || !('access_token' in tokens)) throw new SignInError(detail(step2.error) ?? 'Sign-in failed');
  const session = { baseUrl, accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
  await saveSession(session);
  return session;
}

export async function signOut(): Promise<void> {
  await saveSession(null);
}

function detail(error: unknown): string | undefined {
  const value = (error as { detail?: unknown } | undefined)?.detail;
  return typeof value === 'string' ? value : undefined;
}

/** A client that sends the access token and, on a 401, refreshes it once and retries. */
export function authorisedClient(initial: Session, onSignedOut: () => void): ApiClient {
  let session = initial;
  const api = createApiClient(session.baseUrl);
  let refreshing: Promise<boolean> | null = null;

  const refresh = async (): Promise<boolean> => {
    const response = await createApiClient(session.baseUrl).POST('/api/auth/refresh', {
      body: { refresh_token: session.refreshToken },
    });
    if (!response.data) {
      await saveSession(null);
      onSignedOut();
      return false;
    }
    session = { ...session, accessToken: response.data.access_token, refreshToken: response.data.refresh_token };
    await saveSession(session);
    return true;
  };

  api.use({
    onRequest({ request }) {
      request.headers.set('Authorization', `Bearer ${session.accessToken}`);
      return request;
    },
    async onResponse({ request, response }) {
      if (response.status !== 401 || request.method !== 'GET') return undefined; // unchanged
      refreshing ??= refresh().finally(() => (refreshing = null));
      if (!(await refreshing)) return undefined;
      const retry = new Request(request, { headers: new Headers(request.headers) });
      retry.headers.set('Authorization', `Bearer ${session.accessToken}`);
      return fetch(retry);
    },
  });
  return api;
}
