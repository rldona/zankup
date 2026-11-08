import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RouterProvider, type createBrowserRouter } from 'react-router';

type Router = ReturnType<typeof createBrowserRouter>;

export function App({ queryClient, router }: { queryClient: QueryClient; router: Router }) {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
