import { readFileSync } from 'node:fs';

import type { Page, Route } from '@playwright/test';

/** The shared catalogues, so expectations follow the same words the app shows. */
const catalogue = (locale: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../packages/core/src/i18n/${locale}.json`, import.meta.url), 'utf8'),
  ) as Record<string, string>;
const catalogues = { en: catalogue('en'), es: catalogue('es') };

/** A message in that language, with {placeholders} filled. */
export function word(lang: 'en' | 'es', key: string, values: Record<string, string> = {}): string {
  const template = catalogues[lang][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

const n = 121;
const STREAMS = {
  t: Array.from({ length: n }, (_, i) => i * 15),
  dist: Array.from({ length: n }, (_, i) => i * 45),
  alt: Array.from({ length: n }, (_, i) => 600 + 20 * Math.sin(i / 10)),
  hr: Array.from({ length: n }, (_, i) => 130 + (i % 30)),
  lat: Array.from({ length: n }, (_, i) => 40.4 + i * 0.0003),
  lon: Array.from({ length: n }, (_, i) => -3.7 + Math.sin(i / 15) * 0.002),
};

const RUN = {
  id: 7,
  name: 'Morning run',
  sport: 'run',
  sub_sport: null,
  source: 'garmin',
  start_utc: '2026-11-07T08:00:00Z',
  timezone: '+01:00',
  duration_s: 1850,
  moving_s: 1800,
  distance_m: 5400,
  ascent_m: 48,
  avg_hr: 148,
  avg_power: null,
  has_gps: true,
  route: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
};
const RIDE = {
  ...RUN,
  id: 6,
  name: 'Hill ride',
  sport: 'ride',
  start_utc: '2026-10-28T16:00:00Z',
  distance_m: 32000,
  moving_s: 4200,
  duration_s: 4400,
};

const DETAIL = {
  ...RUN,
  description: 'Easy pace along the river.',
  descent_m: 46,
  max_hr: 171,
  normalized_power: null,
  calories: 410,
  training_effect: 2.8,
  device: 'Forerunner 965',
  bbox: [40.4, -3.702, 40.436, -3.698],
  has_fit: true,
  imported_at: '2026-11-07T09:00:00Z',
  laps: [
    {
      idx: 0,
      start_utc: RUN.start_utc,
      duration_s: 900,
      distance_m: 2700,
      avg_hr: 140,
      max_hr: 150,
      avg_power: null,
      ascent_m: 24,
      descent_m: 20,
    },
    {
      idx: 1,
      start_utc: RUN.start_utc,
      duration_s: 900,
      distance_m: 2700,
      avg_hr: 156,
      max_hr: 171,
      avg_power: null,
      ascent_m: 24,
      descent_m: 26,
    },
  ],
  splits: [
    { distance_m: 1000, time_s: 330, elevation_change_m: 4, avg_hr: 138 },
    { distance_m: 1000, time_s: 322, elevation_change_m: -2, avg_hr: 147 },
  ],
  best_efforts: [{ distance_key: '5k', distance_m: 5000, time_s: 1640, start_s: 0, start_distance_m: 0 }],
  sets: [],
  metrics: null,
  route_group: null,
  segments: [],
  streams: { series: Object.keys(STREAMS), sample_count: n },
};

const ME = {
  id: 1,
  email: 'runner@example.com',
  display_name: 'Runner',
  totp_enabled: true,
  google_linked: false,
};

/** A fake Zankup API in the browser: signed out until password + code, then a small account. */
export async function fakeApi(page: Page) {
  const state = {
    signedIn: false,
    settings: {
      theme: 'system',
      language: null as string | null,
      units: 'metric',
      hr_max: 190,
      hr_rest: 50,
      hr_max_estimate: 188,
      zone_model: 'max',
      lthr: null,
      ftp: null,
      privacy_zones: [{ id: 'home', name: 'Home', lat: 40.4, lon: -3.7, radius_m: 400 }],
      notifications: {
        activity: true,
        record: true,
        sync_error: true,
        garmin_key: true,
        estimate: false,
        import: true,
      },
    },
  };
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route(/tiles\.openfreemap\.org|fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const today = url.searchParams.get('today') ?? '2026-11-09';

    if (path === '/api/setup') return json(route, { open: false });
    if (path === '/api/auth/google/providers') return json(route, { google: false });
    if (path === '/api/auth/login') return json(route, { mfa_required: true, challenge: 'c' });
    if (path === '/api/auth/login/totp') {
      const { code } = request.postDataJSON() as { code: string };
      if (code !== '123456') return json(route, { detail: 'Incorrect e-mail, password or code' }, 401);
      state.signedIn = true;
      return json(route, ME);
    }
    if (!state.signedIn) return json(route, { detail: 'Not signed in' }, 401);

    if (path === '/api/auth/me') return json(route, ME);
    if (path === '/api/ai/status')
      return json(route, {
        available: false,
        enabled: true,
        summaries: true,
        weekly: true,
        model: null,
        budget: null,
        sends: [],
        never_sends: [],
      });
    if (path === '/api/ai/tokens') return json(route, []);
    if (path.endsWith('/summary')) return json(route, { detail: 'No summary yet' }, 404);
    if (path === '/api/auth/logout') {
      state.signedIn = false;
      return route.fulfill({ status: 204 });
    }
    if (path === '/api/settings') {
      if (method === 'PATCH') state.settings = { ...state.settings, ...(request.postDataJSON() as object) };
      return json(route, state.settings);
    }
    if (path === '/api/activities') {
      const sport = url.searchParams.getAll('sport');
      return json(route, {
        items: [RUN, RIDE].filter((a) => !sport.length || sport.includes(a.sport)),
        next_cursor: null,
      });
    }
    if (path === '/api/activities/months')
      return json(route, [
        { month: '2026-11', count: 1, distance_m: 5400, moving_s: 1800, ascent_m: 48 },
        { month: '2026-10', count: 1, distance_m: 32000, moving_s: 4200, ascent_m: 300 },
      ]);
    if (path === '/api/activities/7') return json(route, DETAIL);
    if (path === '/api/activities/7/streams') return json(route, STREAMS);
    if (path === '/api/activities/search') {
      const sport = url.searchParams.getAll('sport');
      const items = [RUN, RIDE].filter((a) => !sport.length || sport.includes(a.sport));
      return json(route, {
        items,
        totals: {
          count: items.length,
          distance_m: items.reduce((s, a) => s + a.distance_m, 0),
          moving_s: items.reduce((s, a) => s + a.moving_s, 0),
          ascent_m: items.reduce((s, a) => s + a.ascent_m, 0),
        },
        next_offset: null,
      });
    }
    if (path === '/api/week') {
      const monday = '2026-11-09';
      return json(route, {
        today,
        // A run and a ride on Monday, a ride on Tuesday: the circles, the second sport's dot and the
        // days without an activity all show.
        days: Array.from({ length: 7 }, (_, i) => ({
          date: `2026-11-${String(9 + i).padStart(2, '0')}`,
          activities:
            i === 0
              ? [
                  { id: 7, sport: 'run', name: 'Morning run' },
                  { id: 8, sport: 'ride', name: 'Hill ride' },
                ]
              : i === 1
                ? [{ id: 8, sport: 'ride', name: 'Hill ride' }]
                : [],
        })),
        this_week: { week_start: monday, count: 3, distance_m: 69400, moving_s: 9000, ascent_m: 950 },
        previous: Array.from({ length: 12 }, (_, i) => ({
          week_start: `2026-08-${10 + i}`,
          count: 3,
          distance_m: 30000,
          moving_s: 10800,
          ascent_m: 200,
        })),
        streak_weeks: 12,
        records: [],
      });
    }
    if (path === '/api/profile/summary')
      return json(route, {
        year: 2026,
        this_year: [{ sport: 'run', count: 80, distance_m: 640000, moving_s: 230000, ascent_m: 5000 }],
        all_time: [{ sport: 'run', count: 600, distance_m: 4800000, moving_s: 1700000, ascent_m: 40000 }],
        since: '2014-03-01T08:00:00Z',
        records: [
          {
            distance_key: '10k',
            distance_m: 10000,
            time_s: 2580,
            activity_id: 7,
            date: '2025-04-06T08:00:00Z',
          },
        ],
        streak_weeks: 12,
        device: 'Forerunner 965',
      });
    if (path === '/api/sources')
      return json(route, [
        {
          kind: 'garmin',
          configured: true,
          key_expires_on: null,
          expiring_soon: false,
          token_expires_at: null,
          last_sync_at: '2026-11-09T07:45:00Z',
          last_error: null,
        },
      ]);
    if (path === '/api/auth/devices')
      return json(route, [
        {
          id: 1,
          name: 'Chrome on Linux',
          platform: 'web',
          created_at: '2026-11-01T10:00:00Z',
          last_seen: '2026-11-09T08:00:00Z',
          expires_at: null,
          current: true,
        },
      ]);
    if (path === '/api/auth/passkeys') return json(route, []);
    if (path === '/api/sync') return json(route, []);
    // Phase 3: the engine's tables
    const t5 = (count: number) => ({
      count,
      distance_m: count * 8000,
      moving_s: count * 2700,
      ascent_m: count * 60,
      load: count * 70,
    });
    if (path === '/api/stats/years') return json(route, [2026, 2025]);
    if (path === '/api/stats/fitness')
      return json(
        route,
        Array.from({ length: 60 }, (_, i) => ({
          day: `2026-09-${String((i % 30) + 1).padStart(2, '0')}`,
          load: 40,
          ctl: 30 + i / 5,
          atl: 28,
          tsb: 2,
        })),
      );
    if (path === '/api/stats/summary')
      return json(route, { current: t5(40), previous: t5(30), by_sport: { run: t5(30), ride: t5(10) } });
    if (path === '/api/stats/volume')
      return json(
        route,
        Array.from({ length: 12 }, (_, i) => ({
          start: `2026-${String(i + 1).padStart(2, '0')}-01`,
          totals: t5(4),
          by_sport: { run: t5(3), ride: t5(1) },
        })),
      );
    if (path === '/api/stats/curves')
      return json(
        route,
        [5, 60, 300, 1200].map((d) => ({
          duration_s: d,
          value: 4 - d / 1000,
          activity_id: 7,
          day: '2026-11-07',
        })),
      );
    if (path === '/api/stats/records')
      return json(route, {
        all_time: [{ distance_key: '5k', distance_m: 5000, time_s: 1640, activity_id: 7, day: '2026-11-07' }],
        period: [],
        progression: {},
      });
    if (path === '/api/stats/estimates')
      return json(route, [
        {
          kind: 'vdot',
          value: 40.1,
          method: 'vdot:5',
          day: '2026-11-09',
          sources: [{ id: 7, name: 'Morning run', sport: 'run', day: '2026-11-07' }],
          history: [],
        },
      ]);
    if (path === '/api/stats/progress') return json(route, [{ year: 2026, cumulative_m: [0, 5000, 12000] }]);
    if (path === '/api/stats/efficiency') return json(route, []);
    if (path === '/api/stats/calendar')
      return json(
        route,
        Array.from({ length: 35 }, (_, i) => ({
          day: new Date(Date.UTC(2026, 9, 26 + i)).toISOString().slice(0, 10),
          tsb: 3,
          activities:
            i === 12
              ? [{ id: 7, sport: 'run', name: 'Morning run', load: 60, distance_m: 5400, moving_s: 1800 }]
              : [],
        })),
      );
    if (path === '/api/stats/heatmap') return json(route, { routes: [RUN.route] });
    if (path === '/api/routes') return json(route, []);
    if (path === '/api/segments') return json(route, []);
    if (path === '/api/goals') return json(route, []);
    if (path === '/api/events') return json(route, []);
    if (path === '/api/engine')
      return json(route, {
        running: false,
        reason: null,
        done: 0,
        total: 0,
        computed: 2,
        activities: 2,
        metrics_version: 2,
      });
    // Phase 4 (OS-401 to OS-414).
    if (path === '/api/gear')
      return json(route, [
        {
          id: 1,
          kind: 'shoe',
          name: 'Trainers',
          brand: null,
          model: null,
          sports: ['run'],
          initial_m: 0,
          limit_m: 800000,
          retired: false,
          distance_m: 420000,
          activities: 40,
          moving_s: 140000,
          first_used: '2026-01-01T08:00:00Z',
          last_used: '2026-11-08T08:00:00Z',
          over_limit: false,
        },
      ]);
    if (path === '/api/imports') return json(route, []);
    if (path === '/api/exports') return json(route, []);
    if (path === '/api/activities/7/shares') return json(route, []);
    if (path === '/api/stats/strava-comparison') return json(route, { metrics: [], effort_scale: null });
    if (path === '/api/stats/review')
      return json(route, {
        period: 'month',
        start: '2026-11-01',
        end: '2026-12-01',
        totals: { count: 2, distance_m: 37400, moving_s: 6000, ascent_m: 348, load: 150 },
        previous: { count: 1, distance_m: 30000, moving_s: 5000, ascent_m: 200, load: 100 },
        by_sport: { run: { count: 1, distance_m: 5400, moving_s: 1800, ascent_m: 48, load: 50 } },
        active_days: 2,
        longest_streak: 1,
        longest: { id: 7, name: 'Morning run', sport: 'run', day: '2026-11-08', distance_m: 5400,
                   moving_s: 1800, ascent_m: 48, load: 50 }, // prettier-ignore
        hardest: null,
        hilliest: null,
        records: [],
        gear: [],
        buckets: Array.from({ length: 30 }, (_, i) => ({
          start: `2026-11-${String(i + 1).padStart(2, '0')}`,
          distance_m: i === 7 ? 5400 : 0,
          moving_s: 0,
          count: i === 7 ? 1 : 0,
        })),
        photos: 0,
      });
    if (path === '/api/public/shares/demo')
      return json(route, {
        name: 'Morning run',
        sport: 'run',
        sub_sport: null,
        day: '2026-11-08',
        athlete: 'Runner',
        duration_s: 1900,
        moving_s: 1800,
        distance_m: 5400,
        ascent_m: 48,
        avg_hr: 145,
        avg_power: null,
        route: [STREAMS.lat.slice(20).map((lat, i) => [lat, STREAMS.lon[i + 20] ?? 0])],
        profile: STREAMS.dist.map((d, i) => ({
          distance_m: d,
          altitude_m: STREAMS.alt[i] ?? null,
          speed: 3,
        })),
        splits: [{ distance_m: 1000, time_s: 330, elevation_change_m: 4 }],
        photos: [],
        expires_at: '2026-11-15T08:00:00Z',
      });
    return json(route, { detail: 'Not Found' }, 404);
  });
}

export async function signIn(page: Page, lang: 'en' | 'es') {
  await page.goto('/sign-in');
  await page.getByLabel(word(lang, 'signIn.email')).fill('runner@example.com');
  await page.getByLabel(word(lang, 'signIn.password'), { exact: true }).fill('a long and unique passphrase');
  await page.getByRole('button', { name: word(lang, 'signIn.submit'), exact: true }).click();
  await page.getByRole('heading', { name: word(lang, 'signIn.codeTitle') }).waitFor();
  await page.getByLabel(word(lang, 'signIn.digit', { n: '1' })).pressSequentially('123456');
  await page.waitForURL('/');
}
