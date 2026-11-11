import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (OS-213): the main flows in English and Spanish against the production build,
 * with the API answered by an in-browser fake (e2e/api.ts), so they run anywhere without a backend.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    serviceWorkers: 'block', // so every API call reaches the fake
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-en', use: { ...devices['Desktop Chrome'], locale: 'en-GB' } },
    { name: 'mobile-es', use: { ...devices['Pixel 7'], locale: 'es-ES' } },
    // The rail size (600–1199 px), as the tablet in docs/prototypes/web.
    {
      name: 'tablet-es',
      use: { ...devices['Desktop Chrome'], viewport: { width: 834, height: 1112 }, locale: 'es-ES' },
    },
  ],
  webServer: {
    command: 'corepack pnpm build && corepack pnpm preview --port 4174 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
