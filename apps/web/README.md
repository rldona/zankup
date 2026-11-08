# apps/web

The PWA for desktop and mobile: React + Vite + TypeScript, deployed on Vercel. The design comes from [`docs/prototypes/`](../../docs/prototypes/index.html); the app skeleton arrives in OS-201.

From the repository root (pnpm comes with Node through corepack: `corepack enable`, or prefix commands with `corepack`):

```bash
pnpm install
pnpm --filter @opensport/web dev           # http://localhost:5173, /api proxied to the local backend on :8000
pnpm --filter @opensport/web test          # vitest + Testing Library
pnpm --filter @opensport/web lint          # eslint (typescript-eslint strict, React hooks)
pnpm --filter @opensport/web format:check  # prettier
pnpm --filter @opensport/web build         # type check + production build in dist/
```

TypeScript stays on 6.0 until typescript-eslint supports 7.
