import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { fakeApi, signIn, word } from './api';

/** English on desktop, Spanish on a phone: the language comes from the browser (OS-223). */
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
  await expect(page.getByRole('heading', { name: w('week.title') })).toBeVisible();
  await expect(page.getByRole('link', { name: /Morning run/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Hill ride/ })).toBeVisible();
  await expect(page.locator('.mhead').first()).toContainText('2026');
});

test('open an activity: figures, route, zones and laps', async ({ page }, info) => {
  const w = (key: string) => word(lang(info.project.name), key);
  await signIn(page, lang(info.project.name));
  await page.getByRole('link', { name: /Morning run/ }).click();
  await expect(page).toHaveURL(/\/activities\/7/);
  const detail = page.getByRole('article');
  await expect(detail.getByRole('heading', { name: 'Morning run' })).toBeVisible();
  await expect(detail.getByRole('heading', { name: w('activity.zones') })).toBeVisible();
  await expect(detail.getByRole('heading', { name: w('activity.laps') })).toBeVisible();
  await expect(detail.getByRole('group', { name: w('activity.colourBy') })).toBeVisible();
  // Charts load when they come near the screen (OS-215): on a phone the profile is further down.
  await detail.locator('.profile').scrollIntoViewIfNeeded();
  await expect(detail.locator('.profile svg')).toBeVisible();
  // Leaving the detail inside the app takes the chart down with it: the app must carry on (this
  // crashed in production on 9 Nov 2026).
  await page
    .getByRole('link', { name: w('nav.search') })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.getByRole('searchbox')).toBeVisible();
});

test('search keeps its filters in the URL', async ({ page }, info) => {
  const w = (key: string) => word(lang(info.project.name), key);
  await signIn(page, lang(info.project.name));
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
  await page.goto('/settings');
  await page.getByRole('button', { name: new RegExp(w('theme.oled')) }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'oled');
  await page.reload();
  // The inline boot script sets it before the app's code even loads.
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('oled');
});

test('no serious accessibility problems on the main screens', async ({ page }, info) => {
  await page.goto('/sign-in');
  const scan = async (where: string) => {
    const result = await new AxeBuilder({ page }).analyze();
    const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${where}: ${v.id} (${v.nodes.length})`)).toEqual([]);
  };
  await scan('sign-in');
  await signIn(page, lang(info.project.name));
  for (const path of ['/', '/activities/7', '/search', '/stats', '/profile', '/settings', '/sync']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await scan(path);
  }
});
