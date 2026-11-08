# Zankup brand guide

Zankup is the product name that replaces the working name OpenSport. This document is the single reference for the name, the mark, the wordmark and how to apply them, plus the checklist for migrating the codebase. Decided on 8 November 2026.

## 1. Name

- **Zankup**, from *zancada* (stride) + *up*. Said aloud it also sounds like *back-up*: your strides, kept safe on your own server, which is what the product does.
- Pronunciation: Spanish *zan-KUP*, English *ZANK-up*.
- Spelling: always with **k**. Never *Zancup*, *ZankUp*, *Zank-up* or *Zank Up*.
- Three cases, by context:
  - `Zankup` is the default: app header, prose, documentation, store listings, emails.
  - `ZANKUP` for large, high-impact uses: sign-in panel, splash screen, social images.
  - `zankup` for identifiers: domain, package names, GitHub organisation, footer.
### Claim

- Spanish: **Tus datos deportivos, de principio a fin.** English: **Your sports data, from start to finish.**
- It says what the product does (your whole history, the original files, on your own server) and it is what the mark draws: a start ring, the route, the return. It replaces "Your sports data, on another level" / "Tus datos deportivos, en otro nivel", which promised metrics; that promise can stay as the second line of the sign-in panel ("Sync with Garmin, import your Strava history and follow your form without depending on anyone").
- Where it goes: the README tagline, the PWA manifest `description`, the sign-in panel headline (OS-203), store listings and social images. Always sentence case with the final full stop; never in capitals.

- Why it changed: an established app called "OpenSports" (leagues and pick-up games) already exists in the same store category, and every real-word candidate (Umbral, Senda, Cota, Mirador, Cumbre) had its domains taken. Zankup had `.com`, `.app`, `.dev`, `.io`, `.run` and `.fit` unregistered, and the exact name free on PyPI, npm and GitHub, when checked on 8 November 2026.

## 2. Mark

A letter Z walked bottom-up: it starts at a **start ring** (the route's starting point), runs left along the bottom, climbs the diagonal, and its last stroke **turns back and points up** (zank-up, back-up). Fully rounded strokes and joins. The internal name is "F1".

![Zankup mark](assets/logo-mark.svg)

Geometry (viewBox `0 0 120 90`, one colour):

```svg
<path d="M88 76 H24 L96 28 H44" fill="none" stroke="currentColor" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="100" cy="76" r="9.5" fill="none" stroke="currentColor" stroke-width="8"/>
<polygon points="20,28 40,14 40,42" fill="currentColor" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/>
```

Visual bounds are x 17.5 to 113.5 and y 11.5 to 82.5; centre the mark on (65.5, 47), not on the viewBox centre.

Rules:

- One colour only. The mark takes the foreground colour of the theme it sits on (`fg` on surfaces, `accentFg` on the accent). Render it as a CSS mask over `currentColor`, as the prototype's `.mark` class does, or as an inline SVG with `currentColor`.
- Minimum size 16 px high. At that size the ring becomes a dot; the silhouette still reads as the Z.
- Clear space: at least the stroke width (13/90 of the height) on every side.
- Do not rotate, mirror, outline, add gradients or shadows, change the stroke weight, detach the ring, or replace the arrow with a plain stroke.
- Do not use a bare letter Z from any typeface as the symbol: a bold Z on its own is Zwift's current logo and is not distinctive.

Kept alternatives, not for production: `assets/logo-mark-z4.svg` (same Z without the ring), `assets/logo-mark-flat.svg` and `assets/logo-mark-sharp.svg` (flat terminals).

## 3. Wordmark

- Typeface: **Momo Trust Display** (Google Fonts, SIL Open Font License, single weight 400). Chosen over Concert One and Boldonse because it is rounded like the mark and reads best in lower case.
- No extra letter-spacing. Use the case rules from section 1.
- Load it only for brand text (wordmark, sign-in claim, splash), not for the interface, which stays on the system font stack defined in `packages/core`:

  ```html
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Momo+Trust+Display&display=swap">
  ```

  For a self-hosted build, download the OFL file from Google Fonts and ship it with the app; keep `system-ui, sans-serif` as the fallback.
- There is no outlined (vector) wordmark yet. When one is needed for places without the font (favicons with text, OG images), export it from the font and add it to `assets/`.

## 4. Lock-up

Mark on the left, wordmark on the right, baseline-aligned, with the mark's height equal to the wordmark's ascender height and a gap of about half the mark's height. On dark surfaces both are the theme foreground; on the accent both are `accentFg`.

## 5. Colour

The brand has no colour of its own beyond the product tokens in `packages/core/src/tokens/tokens.json`:

| Use | Light | Dark | OLED |
|---|---|---|---|
| Mark and wordmark on surfaces | `fg` #17191a | `fg` #eceeed | `fg` #f2f2f2 |
| Mark and wordmark on the accent | `accentFg` #ffffff | `accentFg` #06221a | `accentFg` #001a12 |
| Accent | #0b8f6a | #20c997 | #38d9a9 |
| App icons | `accentFg` mark #06221a on the dark-theme accent #20c997, as on the sign-in panel | | |

## 6. Assets

All in `docs/brand/assets/`:

| File | Use |
|---|---|
| `logo-mark.svg` | The mark, black on transparent, source of truth |
| `favicon.svg` | 64×64, #06221a mark on #20c997 with 14 px radius |
| `icon-192.png`, `icon-512.png` | PWA icons, #06221a mark on #20c997, rounded square |
| `icon-maskable-512.png` | Android maskable icon, mark inside the 80 % safe zone |
| `apple-touch-icon-180.png` | iOS home-screen icon |
| `manifest.webmanifest` | PWA manifest with name, colours and the icons above |

Everything here is an original design made for the project; nothing is traced from third-party material. The earlier mountain mark in `docs/prototypes/assets/logo-mark.svg` was traced from a template and **must not ship**: replace it when implementing this guide.

Status on 8 November 2026: no domain registered and no trademark search done yet. Before public use, register `zankup.com` and `zankup.app`, reserve `zankup` on PyPI, npm and GitHub, and run a trademark search (TMview for the EU, USPTO for the US) in classes 9 and 42.

## 7. Migrating OpenSport to Zankup

Two pieces of work, tracked separately. Do the rename only after the domain and trademark checks above.

### 7.1 Apply the mark and icons (issue #116)

1. Put the mark in `packages/core` as the single source of truth: the SVG path data exported for a CSS mask (PWA) and as a React Native component or path data (Expo). Add a test that the export matches `assets/logo-mark.svg`.
2. In `apps/web`, replace the "OS" text badge and the old mountain with the mark wherever the brand appears (header, sign-in panel, settings), and wire `favicon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon-180.png` and the manifest.
3. Load Momo Trust Display for brand text only, with the system stack as fallback.
4. Check legibility at 16 px in every theme in `tokens.json` (light, dark, oled, and any high-contrast theme).
5. Delete or replace `docs/prototypes/assets/` (the traced mountain and its icons) and the prototype's `.mark` mask URL.
6. Expo: adaptive icon from the same mark, #06221a on #20c997 (monochrome layer white, Android tints it); splash, white mark on #111.

### 7.2 Rename the product

1. UI strings in the `en` and `es` catalogues in `packages/core`: product name, the sign-in claim (new wording from section 1) and titles, the recovery-codes file name, every "OpenSport" in copy. Apply the case rules from section 1.
2. PWA `manifest.webmanifest` (`name`, `short_name`, `description` with the new claim) and `<title>`.
3. `README.md` (title and tagline), `docs/architecture.md`, `docs/roadmap.md` (the brand note and the OS-203 claim), `docs/findings.md` and this folder's references.
4. Python: distribution `opensport-metrics` → `zankup-metrics` in `packages/metrics/pyproject.toml`; the root `pyproject.toml` project name; the `opensport` import package only if cheap and safe, otherwise keep the module path and say so in the PR.
5. Node: package names in `apps/*/package.json` and `packages/*/package.json`, and `pnpm-workspace.yaml` if it lists them.
6. Docker Compose service names and the Postgres database, user and password defaults in `compose.yaml` and `.env.example`, with a note for existing local databases.
7. Deployment: Railway and Vercel project names and URLs, then the custom domain (OS-D06) once registered.
8. GitHub: rename the repository and the organisation last, after the domain, and update the clone URL in `README.md`. GitHub redirects the old URL.
9. Done when `grep -ri opensport` only hits git history, the kept Python module path and this guide's "why it changed" paragraph.

## 8. Exploration

The decision trail is in `exploration/`: `mountain/` holds the first logo round (mountain and switchback trail, candidate N1), `zankup/` holds the Z rounds, the fusion with the start ring, and the wordmark comparisons. Each `comparison-*.png` is a rendered sheet; the matching `.html` regenerates it in a browser. The working page with every naming check (domains via registry RDAP, PyPI, npm, GitHub, app stores) lives outside the repo.
