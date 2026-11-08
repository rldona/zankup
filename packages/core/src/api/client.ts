import createClient, { type Client } from 'openapi-fetch';

import type { paths } from './schema';

export type ApiPaths = paths;
export type ApiClient = Client<paths>;

/**
 * Typed client for the Zankup API, generated from the backend's OpenAPI document.
 * Without a base URL it uses the page's origin: the Vite proxy in development and the Vercel rewrite in
 * production. The Android app passes the instance URL it was configured with.
 */
export function createApiClient(baseUrl?: string, fetchImpl?: typeof fetch): ApiClient {
  const origin = baseUrl ?? (typeof location === 'undefined' ? '' : location.origin);
  // Resolve fetch on every call (not at creation), so tests and polyfills that replace it later still apply.
  const fetcher: typeof fetch = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  return createClient<paths>({ baseUrl: origin, fetch: fetcher });
}
