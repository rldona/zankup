import { ApiError, createApiClient, queryKeys } from '@zankup/core';
import { QueryClient } from '@tanstack/react-query';

/** One API client for the whole app: same origin, so the session cookie goes with every call. */
export const api = createApiClient();

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Long enough for what is kept offline (OS-211) to be restored on the next visit.
      gcTime: 7 * 24 * 60 * 60 * 1000,
      // Offline, show what is cached instead of waiting for a network that is not there.
      networkMode: 'offlineFirst',
      // A 4xx will not fix itself by asking again; network and 5xx errors get two more tries.
      retry: (failures, error) => !(error instanceof ApiError && error.status < 500) && failures < 2,
    },
  },
});

// A 401 anywhere means the session ended (expired, signed out elsewhere, revoked): forget the user so
// the session guard sends the next render to sign-in.
api.use({
  onResponse({ response, request }) {
    if (response.status === 401 && !new URL(request.url).pathname.startsWith('/api/auth/')) {
      queryClient.setQueryData(queryKeys.me, null);
    }
    return undefined;
  },
});
