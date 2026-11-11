# Web redesign mockups (parity with the Android app)

Static sketches of how `apps/web` should lay out on phone, tablet and desktop so that it matches the
Android app (`apps/mobile`). They fix **structure, order and behaviour per width**. They are not a visual
spec: build with the existing components, tokens and icons, not with the inline styles in these files.

Open any `.html` file in a browser. The desktop files are fluid (resize the window); the tablet and phone
files are fixed-size frames. Links between screens work.

## Files

| File | Screen | Width |
| --- | --- | --- |
| `inicio-escritorio.html` | Home | ≥ 1200 px |
| `inicio-tablet.html` | Home | 600–1199 px (drawn at 834) |
| `inicio-movil.html` | Home | < 600 px (drawn at 390) |
| `actividades-escritorio.html` | Activities: list + detail | ≥ 1200 px |
| `actividad-movil.html` | Activity detail | < 600 px |
| `salud-escritorio.html` | Health | ≥ 1200 px |
| `objetivos-escritorio.html` | Goals | ≥ 1200 px |
| `tu-escritorio.html` | You | ≥ 1200 px |
| `estadisticas-escritorio.html` | Stats | ≥ 1200 px |
| `coach-escritorio.html` | Coach | ≥ 1200 px |
| `ajustes-escritorio.html` | Settings (General) | ≥ 1200 px |

## What is wrong today (zankup.com, checked 2026-11-11)

- Desktop: content is pinned to the left and every screen has its own `max-width` (760, 980, 1100, 1180,
  1200 px in `index.css`), so wide monitors are mostly empty.
- Tablet: below 1024 px the phone layout is used, stretched to one column with the bottom tab bar.
- Phone: two headers (the `.topbar` with the wordmark and sync, then the page's own title bar). The app
  has one.
- Home: the deployed site shows "Últimos 7 días" before "Métricas"; the app has them the other way round.
- You: the per-sport tables wrap inside cells on a phone ("81 / actividades").

## The frame (`routes/Shell.tsx`)

Three sizes, one navigation:

| Width | Navigation | Content |
| --- | --- | --- |
| < 600 px | Bottom tab bar, as the app (5 tabs, 76 px tall, 28 px icons, filled icon for the current tab) | One column. One header per screen. |
| 600–1199 px | Left rail, 88 px, icon over label | Two columns where it helps |
| ≥ 1200 px | The same rail | Centred, one shared `max-width` of 1320 px for every screen |

The rail:

- Top: wordmark, then Inicio, Actividades, Salud, Objetivos, Tú (same order and icons as the app's tabs).
- Bottom: Coach (only when the server has a model), Notificaciones, Ajustes. These replace the old
  "Sincronizar" button.
- Sync moves to the Activities header, as in the app.
- Coach and Ajustes mark their own rail icon as current; Stats and the other screens under You keep
  "Tú" marked and show a "‹ Tú" link above the title.

Headers:

- Phone, Home: wordmark on the left, Coach and Notifications on the right (as the app). No separate top bar.
- Phone, other tabs: title on the left, that screen's actions on the right. Pushed screens (an activity)
  have no tab bar and float back/edit/share over the map, as the app.
- Rail sizes, Home: title only (Coach and Notifications are in the rail).

Scrollbars are thin everywhere: `* { scrollbar-width: thin; scrollbar-color: <line> transparent; }`.

## Screens

**Home.** Same order at every size: Esta semana, last day with activities, Métricas, Últimos 7 días.
Desktop: week (7/12) beside the last day (5/12), metrics as one row of four, last seven days as one card.
Tablet: week full width, then last day beside a 2×2 of metrics. "Esta semana" must match the app's
`WeekHeader` + `UsualWeek`: sport icon in a filled circle on days with an activity, a dot for a second
sport, the day number on days without one, today ringed in the accent, future days dimmed, the four
totals, then "Tiempo de entreno" with the bar and the usual-week mark.

**Activities.** List (360–400 px) beside the detail. Detail: map across the full width with replay and
the colour-by control, title with Edit / Share / Add photos, the six figures in one row, charts in a 2×2
grid, and a side column with the Coach summary and the zones. Phone: the app's order (map, title,
figures, Coach, profile chart with metric chips, zones…).

**Health.** "Anoche" (score, duration, stage lanes) beside "Hoy" (six tiles, 2×3), then the three trend
charts in one row.

**Goals.** Goal cards in a grid; Edit and Add goal as labelled buttons in the header.

**You.** Profile card and the menu in a fixed left column; year summary, per-sport tables, records and
physical data on the right. Tables scroll sideways instead of wrapping.

**Stats.** The app's order (Ahora, Forma y fatiga, Volumen, Mejores esfuerzos, Récords, Año a año,
Eficiencia aeróbica, comparison with Strava, Resumen, Más) in rows of two cards of equal height, so
there are no holes. Calendar and Heatmap are labelled buttons in the header.

**Coach.** Weekly report on the left, the conversation on the right with the suggestions centred and the
question field fixed at the bottom.

**Settings.** The eight sections on the left, the chosen section on the right.

## What is only a sketch

- Font (Inter here), the wordmark (plain text here) and all colours come from the real app: use
  `packages/core` tokens and `Wordmark`.
- Icons are the app's Material Symbols (`MATERIAL_ICONS`, `SPORT_ICONS`), inlined here.
- Chart curves and the map are drawn by hand; use the real ECharts/MapLibre components.
- Figures are the owner's real ones on the day of the sketch, except "Normal · 5 h 10 min" and "−43 %"
  under "Tiempo de entreno", which are invented.

## Choices that are not in the app (confirm before building)

- Health: the period is a visible segmented control instead of the header menu.
- You: physical data hidden by default on large screens, shown with the eye button.
- Goals: the evolution chart is open on desktop (in the app it is behind "Ver evolución").
- Settings › Notifications says "En este navegador" instead of "En este teléfono".

## Not drawn yet

Estimates, Gear, Import, Account, Notifications, Calendar, Heatmap, Routes, Segments, Search, Review,
and the tablet and phone versions of every screen except Home (and the activity on a phone). For those,
apply the frame above and the app's own order.
