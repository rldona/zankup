import { createBrowserRouter, type RouteObject } from 'react-router';

import { Activity } from './routes/Activity';
import { AppError } from './routes/AppError';
import { Feed, PickActivity } from './routes/Feed';
import { NotFound } from './routes/NotFound';
import { Profile } from './routes/Profile';
import { RequireSession } from './routes/RequireSession';
import { Setup } from './routes/Setup';
import { Shell } from './routes/Shell';
import { SignIn } from './routes/SignIn';
import { Catalogue } from './routes/Catalogue';
import { ForgotPassword, ResetPassword } from './routes/Recover';
import { Search } from './routes/Search';
import { Settings } from './routes/Settings';
import { Stats } from './routes/Stats';
import { Sync } from './routes/Sync';

/** Every screen. Public: /sign-in and /setup. Everything else needs a session. */
const screens: RouteObject[] = [
  {
    element: <Feed />,
    children: [
      { index: true, element: <PickActivity /> },
      { path: 'activities/:id', element: <Activity /> },
    ],
  },
  { path: 'search', element: <Search /> },
  { path: 'stats', element: <Stats /> },
  { path: 'sync', element: <Sync /> },
  { path: 'settings', element: <Settings /> },
  { path: 'catalogue', element: <Catalogue /> },
  { path: 'profile', element: <Profile /> },
  { path: '*', element: <NotFound /> },
];

export const routes: RouteObject[] = [
  {
    errorElement: <AppError />,
    children: [
      { path: '/sign-in', element: <SignIn /> },
      { path: '/setup', element: <Setup /> },
      { path: '/forgot', element: <ForgotPassword /> },
      { path: '/reset-password', element: <ResetPassword /> },
      {
        element: <RequireSession />,
        children: [
          {
            element: <Shell />,
            // An error in a screen shows inside the frame, with the navigation still there.
            children: [{ errorElement: <AppError />, children: screens }],
          },
        ],
      },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
