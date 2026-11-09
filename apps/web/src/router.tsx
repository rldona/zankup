import { createBrowserRouter, type RouteObject } from 'react-router';

import { Activity } from './routes/Activity';
import { AppError } from './routes/AppError';
import { Feed, PickActivity } from './routes/Feed';
import { Health } from './routes/Health';
import { NotFound } from './routes/NotFound';
import { Profile } from './routes/Profile';
import { RequireSession } from './routes/RequireSession';
import { Setup } from './routes/Setup';
import { Shell } from './routes/Shell';
import { SignIn } from './routes/SignIn';
import { Catalogue } from './routes/Catalogue';
import { Coach } from './routes/Coach';
import { ForgotPassword, ResetPassword } from './routes/Recover';
import { Search } from './routes/Search';
import { Settings } from './routes/Settings';
import { Gear, Import } from './routes/Library';
import { Review } from './routes/Review';
import { Shared } from './routes/Shared';
import { Stats } from './routes/Stats';
import { Sync } from './routes/Sync';
import {
  Heatmap,
  RoutesList,
  RouteView,
  SegmentsList,
  SegmentView,
  TrainingCalendar,
} from './routes/Training';

/** Every screen. Public: sign-in, setup, password recovery and shared activities (/s/…). */
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
  { path: 'stats/calendar', element: <TrainingCalendar /> },
  { path: 'stats/heatmap', element: <Heatmap /> },
  { path: 'health', element: <Health /> },
  { path: 'coach', element: <Coach /> },
  { path: 'routes', element: <RoutesList /> },
  { path: 'routes/:id', element: <RouteView /> },
  { path: 'segments', element: <SegmentsList /> },
  { path: 'segments/:id', element: <SegmentView /> },
  { path: 'sync', element: <Sync /> },
  { path: 'settings', element: <Settings /> },
  { path: 'settings/import', element: <Import /> },
  { path: 'gear', element: <Gear /> },
  { path: 'review/:period', element: <Review /> },
  { path: 'review/:period/:value', element: <Review /> },
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
      { path: '/s/:token', element: <Shared /> }, // a shared activity: no session (OS-408)
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
