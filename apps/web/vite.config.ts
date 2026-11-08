/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

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
export default defineConfig({
  plugins: [react(), themes()],
  // @zankup/core is workspace source, not a package to pre-bundle: edits there (catalogues, tokens,
  // queries) must reach the dev server at once.
  optimizeDeps: { exclude: ['@zankup/core'] },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
