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
- It says what the product does (your whole history, the original files, on your own server) and it is what the mark draws: a stride, out and back. It replaces "Your sports data, on another level" / "Tus datos deportivos, en otro nivel", which promised metrics; that promise can stay as the second line of the sign-in panel ("Sync with Garmin, import your Strava history and follow your form without depending on anyone").
- Where it goes: the README tagline, the PWA manifest `description`, the sign-in panel headline (OS-203), store listings and social images. Always sentence case with the final full stop; never in capitals.

- Why it changed: an established app called "OpenSports" (leagues and pick-up games) already exists in the same store category, and every real-word candidate (Umbral, Senda, Cota, Mirador, Cumbre) had its domains taken. Zankup had `.com`, `.app`, `.dev`, `.io`, `.run` and `.fit` unregistered, and the exact name free on PyPI, npm and GitHub, when checked on 8 November 2026.

## 2. Mark

The **stride**: the n and the u of the wordmark drawn as one line that climbs, arches over, drops down the shared stem and arches back up. A *zancada*, and a route out and back. It comes from the letters the way Strava's chevron comes from its a's: in Momo Trust Display the n is exactly the u turned 180°, so the two letters compose into one stroke. Decided on 9 November 2026 from the exploration in `exploration/zankup/mark-nu*.html`: the falling wave, at the heaviest weight that stays open at 16 px, with round terminals like the earlier Z mark.

![Zankup mark](assets/logo-mark.svg)

Geometry (viewBox `0 0 120 134`, one colour, one stroke):

```svg
<path d="M16 73 V38 A22 22 0 0 1 60 38 V96 A22 22 0 0 0 104 96 V61" fill="none" stroke="currentColor" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>
```

Built on the Momo Trust Display lower case: stems to the x-height, semicircular arches, the n and the u sharing a stem, the u half a body lower. The stroke is 300/1000 em (the font's own is 162) and the counter 14 units, the bold cut the typeface does not have. Visual bounds are x 1 to 119 and y 1 to 133, so the mark is centred on the viewBox centre (60, 67).

Rules:

- One colour only. The mark takes the foreground colour of the theme it sits on (`fg` on surfaces, `accentFg` on the accent). Render it as a CSS mask over `currentColor`, as the web app's `.mark` class does, or as an inline SVG with `currentColor`. The Android app draws the same path with Skia (`apps/mobile/src/Lockup.tsx`), from the geometry exported by `packages/core`.
- Minimum size 16 px high. At that size the counters close to slits; the silhouette still reads as the wave.
- Clear space: at least the stroke width (30/134 of the height) on every side.
- Do not rotate, mirror, outline, add gradients or shadows, change the stroke weight, flatten the terminals, separate the two arches or add a third.
- Do not use the bare letters "nu" from any typeface as the symbol: the mark is the two letters at a weight and an offset the font does not have, and that is what makes it a symbol.

Kept alternatives, not for production: `assets/logo-mark-z.svg` (the earlier mark, a Z walked bottom-up from a start ring whose last stroke turns back and points up, internal name "F1"), `assets/logo-mark-z4.svg` (that Z without the ring), `assets/logo-mark-flat.svg` and `assets/logo-mark-sharp.svg` (flat terminals). The rising wave, the chain links, the padlock and the open ring from the same round stay in `exploration/zankup/`.

## 3. Wordmark

**ZANKUP** in capitals, set in Momo Trust Display with the **N drawn as the U turned 180°**: the two letters share one arch, one open upwards and one downwards (`ZA∩KUP`), and the n and u of the mark are the same pair in lower case. Decided on 9 November 2026 from `exploration/zankup/wordmark-n-inverted-u.html`.

![Zankup wordmark](assets/wordmark.svg)

- The wordmark is a vector, `assets/wordmark.svg` (viewBox `0 0 4289 780`, one path, baseline at 765, cap height 750), exported to `packages/core` as `WORDMARK_PATH` and kept identical by a test. The web app draws it as an inline SVG in `currentColor` (`apps/web/src/Wordmark.tsx`); the Android app with Skia (`apps/mobile/src/Wordmark.tsx`). It needs no web font.
- In the product it goes **alone**: the header and the sign-in, setup, recovery and shared pages show the wordmark, not the mark. The mark is for the app icons, the splash screen and social images.
- Size it by the cap height: 1 rem in the web header, 1.5 rem on the sign-in panel, 22 px on the phone.
- Typeface for other brand text (sign-in claim, splash, store listings): **Momo Trust Display** (Google Fonts, SIL Open Font License, single weight 400), chosen over Concert One and Boldonse because it is rounded like the mark. No extra letter-spacing. The interface stays on the system font stack defined in `packages/core`; load the font only where that brand text appears:

  ```html
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Momo+Trust+Display&display=swap">
  ```

  For a self-hosted build, download the OFL file from Google Fonts and ship it with the app; keep `system-ui, sans-serif` as the fallback. The web app currently loads no brand font: the wordmark is a vector and the claim uses the interface font.
- `Zankup` and `zankup` as plain text follow the case rules in section 1; the inverted N is only for the vector wordmark.

## 4. Lock-up

Only where the mark and the wordmark are needed together (social images, store listings, print): mark on the left, wordmark on the right, baseline-aligned, the mark as high as the capitals and a gap of about half the mark's height. On dark surfaces both are the theme foreground; on the accent both are `accentFg`. The product itself does not use the lock-up (section 3).

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
| `logo-mark-z.svg` | The earlier Z mark, kept as an alternative |
| `wordmark.svg` | ZANKUP with the inverted-U N, one path, source of truth for `packages/core` |
| `favicon.svg` | 64×64, #06221a mark on #20c997 with 14 px radius |
| `icon-192.png`, `icon-512.png` | PWA icons, #06221a mark on #20c997, rounded square |
| `icon-maskable-512.png` | Android maskable icon, mark inside the 80 % safe zone |
| `apple-touch-icon-180.png` | iOS home-screen icon |

The Expo app's icons (`apps/mobile/assets/`: `icon.png`, the Android adaptive layers and `splash-icon.png`) come from the same geometry. All the PNGs are rendered from the SVG path above with Chromium; regenerate them from the path when the mark changes rather than editing them.
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

**Status (9 November 2026):** done for the stride mark. The web app shows the vector wordmark from `packages/core` in the header and on the sign-in, setup, recovery and shared pages, and ships the mark as favicon, PWA icons and manifest; the Android app draws the same wordmark with Skia on sign-in and the lock screen and takes its launcher icon, adaptive layers and splash from `apps/mobile/assets/`. The mark no longer appears inside either app. The prototypes in `docs/prototypes/` keep the traced mountain and are not shipped.

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

**Status (8 November 2026):** done for the code, the documentation and the packages. The Python module was renamed too (`opensport` → `zankup`, `opensport_metrics` → `zankup_metrics`), so `grep -ri opensport` only hits git history, this folder and the prototypes in `docs/prototypes/`, which still have the owner's local edits. The ticket prefix `OS-` stays: it names the issues, not the product. Changing the signing contexts and the session cookie ended every session and made existing TOTP secrets unreadable; production had no TOTP enrolled yet. The Vercel and Railway projects are renamed to `zankup` and `zankup.com` is live (step 7, OS-D06). Pending: the repository rename (step 8).

#### Moving a local database

The Compose project, database, user and password are now `zankup`, so `docker compose` starts a new, empty volume. To bring the old local data across:

```bash
docker start opensport-db-1
docker exec opensport-db-1 pg_dump -U opensport -d opensport --format=custom --no-owner --no-privileges > local.dump
docker stop opensport-db-1
make db
docker exec -i zankup-db-1 pg_restore -U zankup -d zankup --no-owner --no-privileges < local.dump
```

The old volume (`opensport_pgdata`) can be removed with `docker volume rm opensport_pgdata` once the new one has the data. Enrol TOTP again with `python -m zankup.admin enable-totp`.

## 8. Exploration

The decision trail is in `exploration/`: `mountain/` holds the first logo round (mountain and switchback trail, candidate N1), `zankup/` holds the Z rounds, the fusion with the start ring, the wordmark comparisons, and `wordmark-n-inverted-u.*`: the wordmark built from the Momo Trust Display outlines with the N replaced by the U turned 180° (and, as a second column, flipped vertically), in the three cases, in the lock-up and at small sizes, plus one vector SVG per case (`wordmark-n-inverted-u-{caps,title,lower}.svg`). `mark-nu.*` is the symbol round built from the same two letters: six compositions of the n and u (rising and falling wave, links, padlock, open ring, ligature), each as a symbol, as an app icon, at 16 to 32 px and in the lock-up, with one SVG per candidate (`mark-nu-*.svg`). `mark-nu-bold.*` takes the two waves to heavier weights: Momo has a single weight, so the n and u are rebuilt on its geometry as a stroke of 220, 260, 300 and 340 thousandths of an em, with flat terminals like the font and round ones like the Z mark (`mark-nu-zancada-*.svg`). From that sheet the falling wave at 300 with round terminals became the mark (section 2). Each `comparison-*.png` is a rendered sheet; the matching `.html` regenerates it in a browser. The working page with every naming check (domains via registry RDAP, PyPI, npm, GitHub, app stores) lives outside the repo.
