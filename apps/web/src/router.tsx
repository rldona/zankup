import { createBrowserRouter, type RouteObject } from 'react-router';

import { Activity } from './routes/Activity';
import { Feed, PickActivity } from './routes/Feed';
import { NotFound } from './routes/NotFound';
import { Profile } from './routes/Profile';
import { RequireSession } from './routes/RequireSession';
import { Setup } from './routes/Setup';
import { Shell } from './routes/Shell';
import { SignIn } from './routes/SignIn';
import { Settings } from './routes/Settings';
import { Soon } from './routes/Soon';

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
          {
            element: <Feed />,
            children: [
              { index: true, element: <PickActivity /> },
              { path: 'activities/:id', element: <Activity /> },
            ],
          },
          { path: 'search', element: <Soon title="nav.search" body="soon.search" /> },
          { path: 'stats', element: <Soon title="nav.stats" body="soon.stats" /> },
          { path: 'sync', element: <Soon title="nav.sync" body="soon.sync" /> },
          { path: 'settings', element: <Settings /> },
          { path: 'profile', element: <Profile /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
