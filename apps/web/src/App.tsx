import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { RouterProvider, type createBrowserRouter } from 'react-router';

import { keepOffline, OFFLINE_MAX_AGE, persister } from './offline';

type Router = ReturnType<typeof createBrowserRouter>;

/**
 * The app. With `offline`, what has been seen is kept in IndexedDB and restored on the next visit,
 * even without a connection (OS-211). Tests render it without.
 */
export function App({
  queryClient,
  router,
  offline = false,
}: {
  queryClient: QueryClient;
  router: Router;
  offline?: boolean;
}) {
  if (!offline) {
    return (
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  }
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: OFFLINE_MAX_AGE,
        buster: __APP_VERSION__,
        dehydrateOptions: { shouldDehydrateQuery: keepOffline },
      }}
    >
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
  );
}
