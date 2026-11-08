import { createBrowserRouter, type RouteObject } from 'react-router';

import { Activity } from './routes/Activity';
import { Feed } from './routes/Feed';
import { NotFound } from './routes/NotFound';
import { RequireSession } from './routes/RequireSession';
import { Shell } from './routes/Shell';
import { Setup } from './routes/Setup';
import { SignIn } from './routes/SignIn';

/** Every screen. Public: /sign-in and /setup. Everything else needs a session. */
export const routes: RouteObject[] = [
  { path: '/sign-in', element: <SignIn /> },
  { path: '/setup', element: <Setup /> },
  {
    element: <RequireSession />,
    children: [
      {
        element: <Shell />,
        children: [
          { index: true, element: <Feed /> },
          { path: 'activities/:id', element: <Activity /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
