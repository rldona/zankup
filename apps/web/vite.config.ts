/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Relative import: the config is bundled by Vite itself, which reads the workspace source directly.
import { allThemesCss, themeBootScript } from '../../packages/core/src/tokens';

/**
 * Themes (OS-214) in the HTML itself: every theme's CSS variables and the script that applies the
 * saved one, both inline in <head>, so the first paint already has the right colours.
 */
function themes(): Plugin {
  return {
    name: 'zankup-themes',
    transformIndexHtml: () => [
      { tag: 'style', attrs: { 'data-tokens': '' }, children: allThemesCss(), injectTo: 'head-prepend' },
      { tag: 'script', children: themeBootScript(), injectTo: 'head-prepend' },
    ],
  };
}

// In development, /api goes to the local backend (uv run uvicorn …); in production Vercel rewrites it to Railway (OS-006).
/**
 * Installable PWA and offline app (OS-210, OS-211): a service worker precaches the app, falls back to
 * it for every page offline, and keeps the map tiles and fonts it has shown. The manifest is
 * public/manifest.webmanifest. The API is never cached here: what was seen is kept in IndexedDB.
 */
const pwa = VitePWA({
  registerType: 'autoUpdate',
  manifest: false,
  injectRegister: 'script-defer',
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
    maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // MapLibre and its worker
    navigateFallback: '/index.html',
    navigateFallbackDenylist: [/^\/api\//],
    cleanupOutdatedCaches: true,
    runtimeCaching: [
      {
        urlPattern: ({ url }) => url.origin === 'https://tiles.openfreemap.org',
        handler: 'CacheFirst',
        options: {
          cacheName: 'map-tiles',
          expiration: { maxEntries: 4000, maxAgeSeconds: 30 * 24 * 60 * 60 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
      {
        urlPattern: ({ url }) =>
          url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
        handler: 'StaleWhileRevalidate',
        options: { cacheName: 'fonts', expiration: { maxEntries: 20 } },
      },
    ],
  },
});

export default defineConfig({
  plugins: [react(), themes(), pwa],
  define: { __APP_VERSION__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev') },
  // @zankup/core is workspace source, not a package to pre-bundle: edits there (catalogues, tokens,
  // queries) must reach the dev server at once.
  optimizeDeps: { exclude: ['@zankup/core'] },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  test: {
    environment: 'jsdom',
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'], // e2e/ is Playwright's (OS-213)
    setupFiles: ['./src/test/setup.ts'],
  },
});
