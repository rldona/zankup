import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { fakeApi, signIn, word } from './api';

/** English on desktop, Spanish on a tablet and a phone: the language comes from the browser (OS-223). */
const lang = (name: string): 'en' | 'es' => (name.endsWith('-es') ? 'es' : 'en');

test.beforeEach(async ({ page }) => {
  await fakeApi(page);
});

test('sign in with password and code, then the feed', async ({ page }, info) => {
  const w = (key: string) => word(lang(info.project.name), key);
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole('heading', { name: w('signIn.welcome') })).toBeVisible();
  await signIn(page, lang(info.project.name));
  // Home first, as on the app (OS-903, OS-904); the feed is under Activities.
  await expect(page.getByRole('heading', { name: w('week.title'), exact: true })).toBeVisible();
  await page
    .getByRole('link', { name: w('nav.feed'), exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/activities$/);
  await expect(page.getByRole('link', { name: /Morning run/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Hill ride/ })).toBeVisible();
  await expect(page.locator('.mhead').first()).toContainText('2026');
});

test('open an activity: figures, route, zones and laps', async ({ page }, info) => {
  const w = (key: string) => word(lang(info.project.name), key);
  await signIn(page, lang(info.project.name));
  await page.goto('/activities');
  await page.getByRole('link', { name: /Morning run/ }).click();
  await expect(page).toHaveURL(/\/activities\/7/);
  const detail = page.getByRole('article');
  await expect(detail.getByRole('heading', { name: 'Morning run' })).toBeVisible();
  await expect(detail.getByRole('heading', { name: w('activity.zones') })).toBeVisible();
  await expect(detail.getByRole('heading', { name: w('activity.laps') })).toBeVisible();
  // What the route is coloured by lives in the options on the map (OS-908).
  await detail.getByRole('button', { name: w('activity.mapOptions') }).click();
  await expect(detail.getByRole('group', { name: w('activity.colourBy') })).toBeVisible();
  // Charts load when they come near the screen (OS-215), one card each (OS-907).
  await detail.locator('.chartcard').first().scrollIntoViewIfNeeded();
  await expect(detail.locator('.chartcard svg').first()).toBeVisible();
  // On a phone the activity is pushed over the feed, as on the app: no tab bar, and back, edit, share
  // and photos float over the map.
  if ((page.viewportSize()?.width ?? 0) < 600) {
    await expect(page.locator('nav.tabbar')).toBeHidden();
    const bar = page.locator('.floatbar');
    for (const key of ['activity.edit', 'activity.share', 'photos.add'])
      await expect(bar.getByRole('button', { name: w(key) })).toBeVisible();
    await bar.getByRole('button', { name: w('nav.back') }).click();
    await expect(page).toHaveURL(/\/activities$/);
  } else {
    await expect(detail.getByRole('button', { name: w('activity.edit'), exact: true })).toBeVisible();
  }
  // Leaving the detail inside the app takes the charts down with them: the app must carry on (this
  // crashed in production on 9 Nov 2026).
  await page
    .getByRole('link', { name: w('nav.home'), exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: w('week.title'), exact: true })).toBeVisible();
});

test('the frame: tab bar on a phone, the rail from 600 px, one header, no sideways scroll', async ({
  page,
}, info) => {
  const w = (key: string) => word(lang(info.project.name), key);
  await signIn(page, lang(info.project.name));
  const width = page.viewportSize()?.width ?? 0;
  const tabbar = page.locator('nav.tabbar');
  const rail = page.locator('aside.rail');
  for (const path of ['/', '/activities', '/health', '/goals', '/profile', '/stats']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    if (width < 600) {
      await expect(tabbar).toBeVisible();
      await expect(rail).toBeHidden();
    } else {
      await expect(rail).toBeVisible();
      await expect(tabbar).toBeHidden();
    }
    // One title per screen: no top bar of the frame's own above it.
    await expect(page.locator('h1').filter({ visible: true })).toHaveCount(1);
    const overflow = await page.evaluate(() => {
      const main = document.querySelector('main');
      return (main?.scrollWidth ?? 0) - (main?.clientWidth ?? 0);
    });
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
  // Sync is in the Activities header, as in the app.
  await page.goto('/activities');
  await expect(page.getByRole('main').getByRole('button', { name: w('nav.sync') })).toBeVisible();
  // Stats sits under You, with the way back above its title.
  await page.goto('/stats');
  await page.locator('.crumb').click();
  await expect(page).toHaveURL(/\/profile$/);
  if (width >= 1200) {
    const box = await page.locator('main .page').first().boundingBox();
    expect(box?.width).toBeLessThanOrEqual(1320);
  }
});

test("Home in the app's order at every size, with This week as the app's", async ({ page }, info) => {
  const w = (key: string) => word(lang(info.project.name), key);
  await signIn(page, lang(info.project.name));
  await page.goto('/');
  const top = async (key: string) =>
    (await page.getByRole('heading', { name: w(key), exact: true }).boundingBox())?.y ?? -1;
  await expect(page.getByRole('heading', { name: w('home.last7'), exact: true })).toBeVisible();
  const [week, metrics, last7] = [
    await top('week.title'),
    await top('home.metrics'),
    await top('home.last7'),
  ];
  expect(week).toBeLessThan(metrics);
  expect(metrics).toBeLessThan(last7);
  // Monday's run with a dot for the ride, Tuesday's ride, then the days' numbers.
  const days = page.locator('.week .days');
  await expect(days.getByRole('link', { name: /Morning run, Hill ride/ }).locator('.second')).toBeVisible();
  await expect(days.locator('li.future .dot').first()).toHaveText(/^\d+$/);
  await expect(page.getByRole('progressbar', { name: w('home.vsUsual') })).toBeVisible();
});

test('Health, Goals and You: the period segmented, labelled buttons, open charts, hidden data', async ({
  page,
}, info) => {
  const w = (key: string) => word(lang(info.project.name), key);
  const width = page.viewportSize()?.width ?? 0;
  await signIn(page, lang(info.project.name));

  // Health: the period in a segmented control, last night and today, the three trends.
  await page.goto('/health');
  const periods = page.getByRole('group', { name: w('stats.period') });
  await periods.getByRole('button', { name: w('health.period.90') }).click();
  await expect(page).toHaveURL(/days=90/);
  await expect(page.getByRole('heading', { name: w('health.lastNight') })).toBeVisible();
  await expect(page.getByRole('heading', { name: w('health.readinessAndForm') })).toBeVisible();

  // Goals: labelled buttons from 600 px; the chart open on a desktop.
  await page.goto('/goals');
  const add = page.getByRole('button', { name: w('goals.add') });
  await expect(add).toBeVisible();
  if (width >= 600) await expect(add).toContainText(w('goals.add'));
  if (width >= 1200) await expect(page.locator('.goalcard .goalchart, .goalcard svg').first()).toBeVisible();

  // You: the physical data hidden by default on a desktop, the tables scroll instead of wrapping.
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: w('profile.physical') })).toBeVisible();
  const eye = page.getByRole('button', {
    name: w(width >= 1200 ? 'profile.showPhysical' : 'profile.hidePhysical'),
  });
  await expect(eye).toBeVisible();
  const wraps = await page
    .locator('.page.profile .tablescroll td')
    .evaluateAll((cells) => cells.filter((c) => c.getClientRects().length > 1).length);
  expect(wraps).toBe(0);
});

test('Stats, the Coach and Settings at every size', async ({ page }, info) => {
  const w = (key: string) => word(lang(info.project.name), key);
  const width = page.viewportSize()?.width ?? 0;
  await signIn(page, lang(info.project.name));

  // Stats: the calendar and the heatmap in the header; on a desktop the cards in rows of equal height.
  await page.goto('/stats');
  const header = page.locator('.page.stats .titlebar');
  await expect(header.getByRole('link', { name: w('stats.calendar') })).toHaveAttribute(
    'href',
    '/stats/calendar',
  );
  await expect(header.getByRole('link', { name: w('stats.heatmap') })).toHaveAttribute(
    'href',
    '/stats/heatmap',
  );
  if (width >= 1200) {
    const [a, b] = await page
      .locator('.statgrid > .panel')
      .evaluateAll((cards) => cards.slice(0, 2).map((c) => c.getBoundingClientRect()));
    expect(a?.top).toBe(b?.top);
    expect(a?.height).toBe(b?.height);
  }

  // The Coach: the weekly report beside the conversation on a desktop, the page's own top margin.
  await page.route('**/api/ai/status', (route) =>
    route.fulfill({
      json: {
        available: true,
        enabled: true,
        summaries: true,
        weekly: true,
        model: 'm',
        budget: null,
        sends: [],
        never_sends: [],
      },
    }),
  );
  await page.route('**/api/ai/weekly', (route) => route.fulfill({ json: [] }));
  await page.goto('/coach');
  const weekly = page.getByRole('heading', { name: w('weekly.title') });
  const chat = page.getByRole('textbox', { name: w('coach.placeholder') });
  await expect(chat).toBeVisible();
  const [left, right] = [await weekly.boundingBox(), await chat.boundingBox()];
  if (width >= 1200) expect(right?.x ?? 0).toBeGreaterThan((left?.x ?? 0) + (left?.width ?? 0));
  else expect(right?.y ?? 0).toBeGreaterThan(left?.y ?? 0);
  const title = await page.getByRole('heading', { name: w('coach.title'), level: 1 }).boundingBox();
  expect(title?.y ?? 0).toBeGreaterThan(8);

  // Settings: notifications arrive in this browser.
  await page.goto('/settings');
  await expect(page.getByText(w('settings.section.notificationsNoteWeb'))).toBeVisible();
});

test('search keeps its filters in the URL', async ({ page }, info) => {
  const w = (key: string) => word(lang(info.project.name), key);
  await signIn(page, lang(info.project.name));
  // From the search bar under the Activities title, as the app's.
  await page.goto('/activities');
  await page.getByRole('searchbox', { name: w('nav.search') }).fill('hill');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/search\?q=hill$/);
  await page.goto('/search?sport=ride');
  await expect(page.getByRole('link', { name: /Hill ride/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Morning run/ })).toHaveCount(0);
  await expect(page.locator('.results .note').first()).toContainText('1');
  await page
    .getByRole('button', { name: new RegExp(w('search.remove').replace('{filter}', '.*')) })
    .first()
    .click();
  await expect(page).not.toHaveURL(/sport=ride/);
  await expect(page.getByRole('link', { name: /Morning run/ })).toBeVisible();
});

test('a theme picked in Settings survives a reload with no flash', async ({ page }, info) => {
  const w = (key: string) => word(lang(info.project.name), key);
  await signIn(page, lang(info.project.name));
  await page.goto('/settings/general');
  await page.getByRole('button', { name: new RegExp(w('theme.oled')) }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'oled');
  await page.reload();
  // The inline boot script sets it before the app's code even loads.
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('oled');
});

test('no serious accessibility problems on the main screens', async ({ page }, info) => {
  // An axe scan of every main screen takes close to the default 30 s on its own.
  test.setTimeout(90_000);
  await page.goto('/sign-in');
  const scan = async (where: string) => {
    const result = await new AxeBuilder({ page }).analyze();
    const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${where}: ${v.id} (${v.nodes.length})`)).toEqual([]);
  };
  await scan('sign-in');
  await signIn(page, lang(info.project.name));
  for (const path of [
    '/',
    '/activities',
    '/activities/7',
    '/goals',
    '/estimates',
    '/notifications',
    '/search',
    '/stats',
    '/stats/calendar',
    '/routes',
    '/segments',
    '/profile',
    '/settings',
    '/settings/general',
    '/settings/account',
    '/sync',
    '/settings/import',
    '/gear',
    '/review/month/2026-11',
    '/s/demo',
  ]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await scan(path);
  }
});
