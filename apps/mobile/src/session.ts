/**
 * Signing in on the phone (OS-503).
 *
 * - First time: the instance URL, then Google (native account sheet) or password + TOTP. The API
 *   answers with an access token (15 min) and a refresh token.
 * - The refresh token is stored in the Android keystore **behind strong biometrics**
 *   (`requireAuthentication`): it can only be read after the fingerprint, and Android destroys the key if
 *   the enrolled fingerprints change. Every keystore write needs the sensor too, so this token is not
 *   rotated (`rotate: false`); it still expires after 90 days unused.
 * - On phones whose only biometric is weak (face unlock on many Samsungs), the person can choose to use
 *   it as an app lock instead: the token is then stored without biometrics and the app asks for any
 *   biometric before opening.
 * - Without any biometric enrolled the token is stored without it (the keystore still encrypts it).
 */
import { createApiClient, type ApiClient } from '@zankup/core';
import * as Device from 'expo-device';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

import { t } from './i18n';
import { keyInvalidated, normaliseUrl } from './links';
import { keys, readSync, storage } from './storage';

const TOKEN = 'zankup.refresh';
const PROTECTED = 'zankup.refresh.protected'; // "1" when TOKEN needs the fingerprint to be read

export const DEFAULT_INSTANCE = 'https://api.zankup.com';

export type Tokens = { access_token: string; refresh_token: string };
export type Session = { baseUrl: string; accessToken: string; refreshToken: string };

export class SignInError extends Error {}

export function instanceUrl(): string | null {
  return readSync(keys.instance);
}

/** Checks that the URL answers like a Zankup API before keeping it. */
export async function checkInstance(input: string): Promise<string> {
  const url = normaliseUrl(input);
  const response = await fetch(`${url}/api/health`).catch(() => null);
  const body = response?.ok
    ? ((await response.json().catch(() => null)) as { status?: string } | null)
    : null;
  if (!body?.status) throw new SignInError(t('mobile.instanceInvalid'));
  await storage.setItem(keys.instance, url);
  return url;
}

export function deviceName(): string {
  return [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || 'Android';
}

function detail(error: unknown): string | undefined {
  const value = (error as { detail?: unknown } | undefined)?.detail;
  return typeof value === 'string' ? value : undefined;
}

// --- signing in ------------------------------------------------------------------------------------

/** Step 1 of password sign-in: returns the challenge for the code. */
export async function passwordStep(baseUrl: string, email: string, password: string): Promise<string> {
  const api = createApiClient(baseUrl);
  const { data, error } = await api.POST('/api/auth/login', {
    body: { email, password, client: 'android', device_name: deviceName(), remember: true },
  });
  if (!data) throw new SignInError(detail(error) ?? t('signIn.error.wrong'));
  return data.challenge;
}

/** Step 2: the authenticator code (or a recovery code). */
export async function codeStep(baseUrl: string, challenge: string, code: string): Promise<Session> {
  const api = createApiClient(baseUrl);
  const { data, error } = await api.POST('/api/auth/login/totp', { body: { challenge, code } });
  if (!data || !('access_token' in data)) throw new SignInError(detail(error) ?? t('signIn.error.wrong'));
  return keep(baseUrl, data);
}

/** Native Google sign-in: the ID token from the account sheet, for this instance's web client. */
export async function googleStep(baseUrl: string, idToken: string): Promise<Session> {
  const api = createApiClient(baseUrl);
  const { data, error } = await api.POST('/api/auth/google/mobile', {
    body: { id_token: idToken, device_name: deviceName() },
  });
  if (!data) throw new SignInError(detail(error) ?? t('mobile.googleRejected'));
  return keep(baseUrl, data);
}

async function keep(baseUrl: string, tokens: Tokens): Promise<Session> {
  await storeRefreshToken(tokens.refresh_token);
  return { baseUrl, accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
}

// --- the refresh token in the keystore --------------------------------------------------------------

export type Biometrics = 'strong' | 'weak' | 'none';

export async function availableBiometrics(): Promise<Biometrics> {
  if (!(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync()))
    return 'none';
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  return level === LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG ? 'strong' : 'weak';
}

export async function storeRefreshToken(token: string): Promise<void> {
  const weakLock = readSync(keys.weakBiometrics) === '1';
  const strong = !weakLock && (await availableBiometrics()) === 'strong';
  await SecureStore.deleteItemAsync(TOKEN).catch(() => undefined);
  await SecureStore.setItemAsync(TOKEN, token, {
    requireAuthentication: strong,
    authenticationPrompt: t('mobile.unlockPrompt'),
  });
  await storage.setItem(PROTECTED, strong ? '1' : '0');
}

export type Unlock = { session: Session } | { signedOut: true } | { cancelled: true };

/**
 * Opening the app: the fingerprint releases the refresh token, which gets a fresh access token. A key
 * Android invalidated (fingerprints changed), a token the server no longer accepts or a missing one
 * mean signing in again.
 */
export async function unlock(): Promise<Unlock> {
  const baseUrl = instanceUrl();
  if (!baseUrl) return { signedOut: true };
  const isProtected = readSync(PROTECTED) === '1';
  if (!isProtected && readSync(keys.weakBiometrics) === '1') {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: t('mobile.unlockPrompt'),
      biometricsSecurityLevel: 'weak',
    });
    if (!result.success) return { cancelled: true };
  }
  let token: string | null;
  try {
    token = await SecureStore.getItemAsync(TOKEN, {
      requireAuthentication: isProtected,
      authenticationPrompt: t('mobile.unlockPrompt'),
    });
  } catch (error) {
    // Only a key Android invalidated (fingerprints changed) is gone for good. Anything else (the
    // prompt cancelled, timed out, locked out, shown with the screen off) leaves the token where it is:
    // the lock screen offers to try again instead of signing out.
    if (!keyInvalidated(error)) return { cancelled: true };
    await forget();
    return { signedOut: true };
  }
  if (!token) return { signedOut: true };
  // Offline (or the server is down): open with what is kept on the phone; the client gets an access
  // token with this refresh token as soon as a request is answered with 401.
  const offline: Unlock = { session: { baseUrl, accessToken: '', refreshToken: token } };
  const result = await createApiClient(baseUrl)
    .POST('/api/auth/refresh', { body: { refresh_token: token, rotate: false } })
    .catch(() => null);
  if (!result) return offline;
  if (!result.data) {
    if (result.response.status === 401) {
      await forget();
      return { signedOut: true };
    }
    return offline;
  }
  return { session: { baseUrl, accessToken: result.data.access_token, refreshToken: token } };
}

export async function forget(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN).catch(() => undefined);
  await storage.removeItem(PROTECTED);
}

/** Signs this phone out on the server too (the device row goes), then forgets the token. */
export async function signOut(api: ApiClient | null): Promise<void> {
  await api?.POST('/api/auth/logout').catch(() => undefined);
  await forget();
}

// --- the client the app uses -----------------------------------------------------------------------

const tokens = new WeakMap<ApiClient, () => string>();

/** The current access token of a client from `authorisedClient`, for requests made outside it (images). */
export function accessToken(api: ApiClient): string {
  return tokens.get(api)?.() ?? '';
}

/** Sends the access token and, on a 401, gets a new one with the refresh token and retries once. */
export function authorisedClient(initial: Session, onSignedOut: () => void): ApiClient {
  let session = initial;
  const api = createApiClient(session.baseUrl);
  let refreshing: Promise<boolean> | null = null;

  const refresh = async (): Promise<boolean> => {
    const result = await createApiClient(session.baseUrl)
      .POST('/api/auth/refresh', { body: { refresh_token: session.refreshToken, rotate: false } })
      .catch(() => null);
    if (!result) return false; // no network: keep the session for later
    if (!result.data) {
      if (result.response.status === 401) {
        // The server no longer accepts this phone (signed out elsewhere, expired): sign in again.
        await forget();
        onSignedOut();
      }
      return false;
    }
    session = { ...session, accessToken: result.data.access_token };
    return true;
  };

  api.use({
    onRequest({ request }) {
      request.headers.set('Authorization', `Bearer ${session.accessToken}`);
      return request;
    },
    async onResponse({ request, response }) {
      // Unchanged: returning the same response breaks requests. Only reads are retried (a body is gone).
      if (response.status !== 401 || request.method !== 'GET') return undefined;
      refreshing ??= refresh().finally(() => (refreshing = null));
      if (!(await refreshing)) return undefined;
      const retry = new Request(request, { headers: new Headers(request.headers) });
      retry.headers.set('Authorization', `Bearer ${session.accessToken}`);
      return fetch(retry);
    },
  });
  tokens.set(api, () => session.accessToken);
  return api;
}
