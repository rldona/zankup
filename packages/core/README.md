# @opensport/core

Shared TypeScript for the PWA (`apps/web`) and, later, the Android app. It holds logic, not visual components.

| Module    | What it has                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `api/`    | Typed client (`createApiClient`) built with `openapi-fetch` on types generated from the backend's OpenAPI document                 |
| `format/` | Durations, distance, pace, speed and dates, in metric or imperial units and in the user's language                                 |
| `domain/` | Sports and domain rules shared by every client                                                                                     |
| `i18n/`   | The `en` (reference) and `es` catalogues in ICU format, language detection and a minimal lookup until i18next (OS-223)             |
| `tokens/` | Design tokens for the seven themes of the prototype, as JSON, plus CSS variable generation (OS-214 builds the theme system on top) |

The package is consumed as TypeScript source (no build step): Vite and Metro compile it with the app.

## API types

`src/api/openapi.json` and `src/api/schema.ts` are generated. After changing an endpoint in the backend, regenerate both from the repository root and commit them; CI fails if they are out of date:

```bash
pnpm generate:api
```

## Scripts

```bash
pnpm --filter @opensport/core test        # vitest
pnpm --filter @opensport/core typecheck   # tsc
pnpm --filter @opensport/core lint        # eslint
```
