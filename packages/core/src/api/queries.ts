/**
 * Query definitions shared by the PWA and the Android app: a stable key and the function that fetches
 * it, as plain objects that TanStack Query's `useQuery` / `useInfiniteQuery` take as they are. No
 * dependency on React here, so they work in both.
 */
import type { ApiClient } from './client';
import type { paths } from './schema';

type Json<P extends keyof paths, M extends 'get' | 'post'> = paths[P][M] extends {
  responses: { 200: { content: { 'application/json': infer T } } };
}
  ? T
  : never;

export type Me = Json<'/api/auth/me', 'get'>;
export type ActivityPage = Json<'/api/activities', 'get'>;
export type ActivitySummary = ActivityPage['items'][number];
export type MonthTotals = Json<'/api/activities/months', 'get'>[number];
export type ActivityStreams = Json<'/api/activities/{activity_id}/streams', 'get'>;
export type ActivityDetail = Json<'/api/activities/{activity_id}', 'get'>;
export type Health = Json<'/api/health', 'get'>;
export type SetupStatus = Json<'/api/setup', 'get'>;
export type Preferences = Json<'/api/settings', 'get'>;
export type DeviceSession = Json<'/api/auth/devices', 'get'>[number];
export type ProfileSummary = Json<'/api/profile/summary', 'get'>;
export type SourceStatus = Json<'/api/sources', 'get'>[number];
export type PasskeyInfo = Json<'/api/auth/passkeys', 'get'>[number];

/** An API error with its HTTP status, so callers can tell "signed out" (401) from other failures. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.data !== undefined) return result.data;
  const detail = (result.error as { detail?: unknown } | undefined)?.detail;
  throw new ApiError(
    result.response.status,
    typeof detail === 'string' ? detail : result.response.statusText,
  );
}

/** Keys: every query about the signed-in user's data starts with its scope, so sign-out clears them all. */
export const queryKeys = {
  health: ['health'] as const,
  setup: ['setup'] as const,
  me: ['me'] as const,
  settings: ['settings'] as const,
  devices: ['devices'] as const,
  profile: ['profile'] as const,
  sources: ['sources'] as const,
  passkeys: ['passkeys'] as const,
  activities: (sport?: readonly string[]) => ['activities', { sport: sport ?? [] }] as const,
  months: (sport?: readonly string[]) => ['activities', 'months', { sport: sport ?? [] }] as const,
  activity: (id: number) => ['activity', id] as const,
  streams: (id: number) => ['activity', id, 'streams'] as const,
};

export function healthQuery(api: ApiClient) {
  return {
    queryKey: queryKeys.health,
    queryFn: async ({ signal }: { signal?: AbortSignal }) => unwrap(await api.GET('/api/health', { signal })),
  };
}

/** The signed-in user, or an ApiError with status 401 when there is no session. */
export function meQuery(api: ApiClient) {
  return {
    queryKey: queryKeys.me,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/auth/me', { signal })),
  };
}

/** The feed, newest first, a page at a time (cursor pagination, OS-111). */
export function activitiesQuery(api: ApiClient, sport?: readonly string[], limit = 30) {
  return {
    queryKey: queryKeys.activities(sport),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }: { pageParam: string | undefined; signal?: AbortSignal }) =>
      unwrap(
        await api.GET('/api/activities', {
          params: { query: { limit, cursor: pageParam, sport: sport?.length ? [...sport] : undefined } },
          signal,
        }),
      ),
    getNextPageParam: (last: ActivityPage) => last.next_cursor ?? undefined,
  };
}

/** Totals per month for the feed's headers (count, distance, time, ascent), newest first. */
export function monthsQuery(api: ApiClient, sport?: readonly string[]) {
  return {
    queryKey: queryKeys.months(sport),
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(
        await api.GET('/api/activities/months', {
          params: { query: { sport: sport?.length ? [...sport] : undefined } },
          signal,
        }),
      ),
  };
}

export function activityQuery(api: ApiClient, id: number) {
  return {
    queryKey: queryKeys.activity(id),
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(
        await api.GET('/api/activities/{activity_id}', { params: { path: { activity_id: id } }, signal }),
      ),
  };
}

/** Whether this instance still has no account, so /setup is open (OS-221). */
export function setupStatusQuery(api: ApiClient) {
  return {
    queryKey: queryKeys.setup,
    queryFn: async ({ signal }: { signal?: AbortSignal }) => unwrap(await api.GET('/api/setup', { signal })),
  };
}

/** The signed-in user's preferences (the theme for now), as stored on the server. */
export function settingsQuery(api: ApiClient) {
  return {
    queryKey: queryKeys.settings,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/settings', { signal })),
  };
}

/** All the series of an activity (sent gzip-compressed; the browser decompresses them). */
export function streamsQuery(api: ApiClient, id: number) {
  return {
    queryKey: queryKeys.streams(id),
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(
        await api.GET('/api/activities/{activity_id}/streams', {
          params: { path: { activity_id: id } },
          signal,
        }),
      ),
    staleTime: Infinity, // a recorded activity's series never change
  };
}

/** Open sessions: every browser and app signed in (Settings → Sessions). */
export function devicesQuery(api: ApiClient) {
  return {
    queryKey: queryKeys.devices,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/auth/devices', { signal })),
  };
}

/** The profile's numbers: this year and all time by sport, records, streak and device (OS-218). */
export function profileSummaryQuery(api: ApiClient) {
  return {
    queryKey: queryKeys.profile,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/profile/summary', { signal })),
  };
}

/** Data sources (Garmin) and their state. */
export function sourcesQuery(api: ApiClient) {
  return {
    queryKey: queryKeys.sources,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/sources', { signal })),
  };
}

/** The passkeys registered for this account (OS-405). */
export function passkeysQuery(api: ApiClient) {
  return {
    queryKey: queryKeys.passkeys,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/auth/passkeys', { signal })),
  };
}
