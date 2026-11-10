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

/** The body of a 201 Created answer. */
type Created<P extends keyof paths> = paths[P]['post'] extends {
  responses: { 201: { content: { 'application/json': infer T } } };
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
export type SyncRun = Json<'/api/sync/{run_id}', 'get'>;
export type Week = Json<'/api/week', 'get'>;
export type SearchParams = NonNullable<paths['/api/activities/search']['get']['parameters']['query']>;
export type SearchPage = Json<'/api/activities/search', 'get'>;
export type PasskeyInfo = Json<'/api/auth/passkeys', 'get'>[number];
export type HealthDay = Json<'/api/wellness/days', 'get'>[number];
export type HealthNight = Json<'/api/wellness/nights/{day}', 'get'>;
export type HealthSettings = Json<'/api/wellness/settings', 'get'>;
export type HealthSourceName = HealthSettings['sources'][number]['source'];
export type HealthMetric = keyof HealthSettings['priority'];

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
  keys: ['keys'] as const,
  instance: ['instance'] as const,
  passkeys: ['passkeys'] as const,
  syncs: ['syncs'] as const,
  providers: ['providers'] as const,
  wellness: ['wellness'] as const,
  search: (params: object) => ['activities', 'search', params] as const,
  week: (today: string) => ['activities', 'week', today] as const,
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

/** The service keys (Garmin's, Anthropic's): set or not, where from, their last characters. */
export function keysQuery(api: ApiClient) {
  return {
    queryKey: queryKeys.keys,
    queryFn: async ({ signal }: { signal?: AbortSignal }) => unwrap(await api.GET('/api/keys', { signal })),
  };
}

export type ServiceKey = Json<'/api/keys', 'get'>[number];

/** The instance's settings the apps can change, each with its value and where it comes from. */
export function instanceQuery(api: ApiClient) {
  return {
    queryKey: queryKeys.instance,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/instance', { signal })),
  };
}

export type InstanceSettings = Json<'/api/instance', 'get'>;
export type InstanceSetting = InstanceSettings['settings'][number];

/** The passkeys registered for this account (OS-405). */
export function passkeysQuery(api: ApiClient) {
  return {
    queryKey: queryKeys.passkeys,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/auth/passkeys', { signal })),
  };
}

/** The latest Garmin syncs, newest first (the first one is the one to follow while it runs). */
export function syncsQuery(api: ApiClient, limit = 10) {
  return {
    queryKey: queryKeys.syncs,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/sync', { params: { query: { limit } }, signal })),
  };
}

/** Extra sign-in methods this instance offers (Google), for the sign-in screen. Public. */
export function providersQuery(api: ApiClient) {
  return {
    queryKey: queryKeys.providers,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/auth/google/providers', { signal })),
    staleTime: Infinity,
  };
}

/** This week (OS-217): days with their activities, totals, the weeks before, streak, recent records. */
export function weekQuery(api: ApiClient, today: string) {
  return {
    queryKey: queryKeys.week(today),
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/week', { params: { query: { today } }, signal })),
  };
}

/** Advanced search (OS-219), a page at a time: any combination of filters, sorted, with totals. */
export function searchQuery(api: ApiClient, params: SearchParams, limit = 50) {
  return {
    queryKey: queryKeys.search(params),
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }: { pageParam: number; signal?: AbortSignal }) =>
      unwrap(
        await api.GET('/api/activities/search', {
          params: { query: { ...params, offset: pageParam, limit } },
          signal,
        }),
      ),
    getNextPageParam: (last: SearchPage) => last.next_offset ?? undefined,
  };
}

// --- Phase 3: the engine's tables (nothing is computed when these are read) -------------------------

export type Period = { from?: string; to?: string };
export type FitnessDay = Json<'/api/stats/fitness', 'get'>[number];
export type StatsSummary = Json<'/api/stats/summary', 'get'>;
export type VolumeBucket = Json<'/api/stats/volume', 'get'>[number];
export type CurvePoint = Json<'/api/stats/curves', 'get'>[number];
export type Records = Json<'/api/stats/records', 'get'>;
export type EstimateOut = Json<'/api/stats/estimates', 'get'>[number];
export type YearLine = Json<'/api/stats/progress', 'get'>[number];
export type CalendarDay = Json<'/api/stats/calendar', 'get'>[number];
export type RouteGroup = Json<'/api/routes', 'get'>[number];
export type RouteDetail = Json<'/api/routes/{group_id}', 'get'>;
export type SegmentOut = Json<'/api/segments', 'get'>[number];
export type SegmentDetail = Json<'/api/segments/{segment_id}', 'get'>;
export type GoalOut = Json<'/api/goals', 'get'>[number];
export type EventOut = Json<'/api/events', 'get'>[number];
export type EngineStatus = Json<'/api/engine', 'get'>;

/** Keys under 'activities' are refreshed after a sync and kept offline, like the feed. */
const stats = (name: string, params: object = {}) => ['activities', 'stats', name, params] as const;

export function fitnessQuery(api: ApiClient, period: Period) {
  return {
    queryKey: stats('fitness', period),
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/stats/fitness', { params: { query: period }, signal })),
  };
}

export function summaryQuery(api: ApiClient, period: Period, sport?: string[]) {
  return {
    queryKey: stats('summary', { ...period, sport }),
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/stats/summary', { params: { query: { ...period, sport } }, signal })),
  };
}

export function volumeQuery(
  api: ApiClient,
  period: Period,
  unit: 'day' | 'week' | 'month' | 'year',
  sport?: string[],
) {
  return {
    queryKey: stats('volume', { ...period, unit, sport }),
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/stats/volume', { params: { query: { ...period, unit, sport } }, signal })),
  };
}

export function curvesQuery(
  api: ApiClient,
  kind: 'power' | 'speed' | 'hr',
  period: Period,
  sport?: string[],
) {
  return {
    queryKey: stats('curves', { ...period, kind, sport }),
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/stats/curves', { params: { query: { ...period, kind, sport } }, signal })),
  };
}

export function recordsQuery(api: ApiClient, period: Period) {
  return {
    queryKey: stats('records', period),
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/stats/records', { params: { query: period }, signal })),
  };
}

export function estimatesQuery(api: ApiClient) {
  return {
    queryKey: stats('estimates'),
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/stats/estimates', { signal })),
  };
}

export function progressQuery(api: ApiClient, sport?: string[], years = 5) {
  return {
    queryKey: stats('progress', { sport, years }),
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/stats/progress', { params: { query: { sport, years } }, signal })),
  };
}

export function efficiencyQuery(api: ApiClient, period: Period, sport = 'run') {
  return {
    queryKey: stats('efficiency', { ...period, sport }),
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/stats/efficiency', { params: { query: { ...period, sport } }, signal })),
  };
}

export function calendarQuery(api: ApiClient, period: Period) {
  return {
    queryKey: stats('calendar', period),
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/stats/calendar', { params: { query: period }, signal })),
  };
}

export function heatmapQuery(api: ApiClient, period: Period, sport?: string[]) {
  return {
    queryKey: stats('heatmap', { ...period, sport }),
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/stats/heatmap', { params: { query: { ...period, sport } }, signal })),
  };
}

export function yearsQuery(api: ApiClient) {
  return {
    queryKey: stats('years'),
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/stats/years', { signal })),
  };
}

export function routesQuery(api: ApiClient) {
  return {
    queryKey: ['activities', 'routes'] as const,
    queryFn: async ({ signal }: { signal?: AbortSignal }) => unwrap(await api.GET('/api/routes', { signal })),
  };
}

export function routeQuery(api: ApiClient, id: number) {
  return {
    queryKey: ['activities', 'routes', id] as const,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/routes/{group_id}', { params: { path: { group_id: id } }, signal })),
  };
}

export function segmentsQuery(api: ApiClient) {
  return {
    queryKey: ['activities', 'segments'] as const,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/segments', { signal })),
  };
}

export function segmentQuery(api: ApiClient, id: number) {
  return {
    queryKey: ['activities', 'segments', id] as const,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/segments/{segment_id}', { params: { path: { segment_id: id } }, signal })),
  };
}

export function goalsQuery(api: ApiClient) {
  return {
    queryKey: ['activities', 'goals'] as const,
    queryFn: async ({ signal }: { signal?: AbortSignal }) => unwrap(await api.GET('/api/goals', { signal })),
  };
}

export function eventsQuery(api: ApiClient) {
  return {
    queryKey: ['activities', 'events'] as const,
    queryFn: async ({ signal }: { signal?: AbortSignal }) => unwrap(await api.GET('/api/events', { signal })),
  };
}

export function engineQuery(api: ApiClient) {
  return {
    queryKey: ['engine'] as const,
    queryFn: async ({ signal }: { signal?: AbortSignal }) => unwrap(await api.GET('/api/engine', { signal })),
  };
}

// --- phase 4: history, privacy and sharing --------------------------------------------------------

export type GearOut = Json<'/api/gear', 'get'>[number];
export type ImportOut = Json<'/api/imports', 'get'>[number];
export type NewImport = Created<'/api/imports'>;
export type ExportOut = Json<'/api/exports', 'get'>[number];
export type ShareOut = Json<'/api/activities/{activity_id}/shares', 'get'>[number];
export type SharedActivity = Json<'/api/public/shares/{token}', 'get'>;
export type Review = Json<'/api/stats/review', 'get'>;
export type StravaComparison = Json<'/api/stats/strava-comparison', 'get'>;
export type PrivacyZone = Preferences['privacy_zones'][number];
export type NotificationPrefs = Preferences['notifications'];
export type PhotoRef = ActivityDetail['photo_list'][number];

export function gearQuery(api: ApiClient) {
  return {
    queryKey: ['activities', 'gear'] as const,
    queryFn: async ({ signal }: { signal?: AbortSignal }) => unwrap(await api.GET('/api/gear', { signal })),
  };
}

export function importsQuery(api: ApiClient) {
  return {
    queryKey: ['imports'] as const,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/imports', { signal })),
  };
}

export function exportsQuery(api: ApiClient) {
  return {
    queryKey: ['exports'] as const,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/exports', { signal })),
  };
}

export function sharesQuery(api: ApiClient, activityId: number) {
  return {
    queryKey: ['activity', activityId, 'shares'] as const,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(
        await api.GET('/api/activities/{activity_id}/shares', {
          params: { path: { activity_id: activityId } },
          signal,
        }),
      ),
  };
}

export function sharedPreviewQuery(api: ApiClient, activityId: number, showMap: boolean) {
  return {
    queryKey: ['activity', activityId, 'shared', showMap] as const,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(
        await api.GET('/api/activities/{activity_id}/shared', {
          params: { path: { activity_id: activityId }, query: { show_map: showMap } },
          signal,
        }),
      ),
  };
}

/** A shared activity, for anyone with the link: no session, so it is not under a user's scope. */
export function sharedActivityQuery(api: ApiClient, token: string) {
  return {
    queryKey: ['public', 'share', token] as const,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/public/shares/{token}', { params: { path: { token } }, signal })),
    retry: false,
  };
}

export function reviewQuery(api: ApiClient, period: 'month' | 'year', value: string) {
  return {
    queryKey: ['activities', 'stats', 'review', { period, value }] as const,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/stats/review', { params: { query: { period, value } }, signal })),
  };
}

export function stravaComparisonQuery(api: ApiClient) {
  return {
    queryKey: ['activities', 'stats', 'strava-comparison'] as const,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/stats/strava-comparison', { signal })),
  };
}

export function pushKeyQuery(api: ApiClient) {
  return {
    queryKey: ['push-key'] as const,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/notifications/key', { signal })),
    staleTime: Infinity,
  };
}

// --- health (phase 6) ------------------------------------------------------------------------------

/** One row per day with health data, one value per metric chosen between sources (OS-605, OS-606). */
export function healthDaysQuery(api: ApiClient, start: string, end: string) {
  return {
    queryKey: [...queryKeys.wellness, 'days', start, end] as const,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/wellness/days', { params: { query: { start, end } }, signal })),
  };
}

/** A night's stages and how each source recorded it. */
export function healthNightQuery(api: ApiClient, day: string) {
  return {
    queryKey: [...queryKeys.wellness, 'night', day] as const,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/wellness/nights/{day}', { params: { path: { day } }, signal })),
  };
}

/** The health sources, their state and the order chosen per metric. */
export function healthSettingsQuery(api: ApiClient) {
  return {
    queryKey: [...queryKeys.wellness, 'settings'] as const,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/wellness/settings', { signal })),
  };
}

// --- AI assistant (phase 7) ------------------------------------------------------------------------

export type AiStatus = Json<'/api/ai/status', 'get'>;
export type AiPrefs = Preferences['ai'];
export type ActivityAiSummary = Json<'/api/activities/{activity_id}/summary', 'get'>;
export type WeeklyReport = Json<'/api/ai/weekly', 'get'>[number];
export type ApiToken = Json<'/api/ai/tokens', 'get'>[number];
export type ApiTokenCreated = Created<'/api/ai/tokens'>;

/** Whether this server has a model, the user's switches and this month's spend (OS-706, OS-708). */
export function aiStatusQuery(api: ApiClient) {
  return {
    queryKey: ['ai', 'status'] as const,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/ai/status', { signal })),
    staleTime: 5 * 60_000,
  };
}

/** The model's summary of an activity (OS-703), or null while there is none. */
export function activitySummaryQuery(api: ApiClient, activityId: number) {
  return {
    queryKey: ['activity', activityId, 'summary'] as const,
    queryFn: async ({ signal }: { signal?: AbortSignal }): Promise<ActivityAiSummary | null> => {
      const result = await api.GET('/api/activities/{activity_id}/summary', {
        params: { path: { activity_id: activityId } },
        signal,
      });
      if (result.response.status === 404) return null;
      return unwrap(result);
    },
    retry: false,
  };
}

/** The weekly reports, newest first (OS-704). */
export function weeklyReportsQuery(api: ApiClient) {
  return {
    queryKey: ['ai', 'weekly'] as const,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/ai/weekly', { signal })),
  };
}

/** The personal tokens of the MCP server (OS-709). */
export function apiTokensQuery(api: ApiClient) {
  return {
    queryKey: ['ai', 'tokens'] as const,
    queryFn: async ({ signal }: { signal?: AbortSignal }) =>
      unwrap(await api.GET('/api/ai/tokens', { signal })),
  };
}
