# Findings: how to get activity data

Research carried out on 6–7 November 2026 for OpenSport. Reference device: Garmin fēnix 6X Pro (firmware 28.02), with Garmin Connect and a free Strava account.

**Conclusion:** the main source will be the **Garmin Connect Personal API**. It is official, free, and returns the original FIT file without anything stripped. It has already been tested with real data ([backend/garmin_sync.py](../backend/garmin_sync.py)). The architecture is described in [architecture.md](architecture.md).

---

## 1. Summary of the options evaluated

| Option | Result | Reason |
|---|---|---|
| **Garmin Personal API** | ✅ **Chosen** | Official, for individuals, no approval needed. The FIT is identical to Garmin's "Export File" |
| Export from the Garmin Connect website (manual) | ✅ As a fallback | Works, but every download needs a click (and Chrome asks where to save) |
| Strava bulk export (ZIP) | ✅ For history only | Free and allowed, but it is not the complete original (see §3) |
| Strava API | ❌ | Since June 2026 it requires a paid subscription, also for personal apps |
| Automating the Strava or Garmin website (agent-browser) | ❌ | The Chrome profile copy does not keep sessions (cookies are encrypted with the system keyring), Cloudflare's bot check kicks in, and the terms of use forbid automated access |
| Claude in Chrome with the real session | ⚠️ Works, cannot be automated | Useful for tests; depends on an open browser and a click on the save dialog |
| Garmin Connect app on the phone (adb over Wi-Fi) | ❌ | Activities live in the app's private storage (needs root). Outside it there is only a map cache. The app does not export FITs. Reading the screen with `uiautomator` only yields summaries |
| Health Connect (Android) | ❌ | Garmin writes sessions, HR, distance and speed there, but **not the GPS track**, and reading it requires our own Android app |
| intervals.icu as an intermediary | ❌ | Since October 2026 it is likely to lose API access to Garmin data, and Garmin sends it stripped FITs (no Training Effect, VO₂max…) |
| python-garminconnect (unofficial) | ❌ Discarded | Fragile: its login library (garth) is abandoned, it broke in March 2026, and it relies on impersonating a browser |
| Watch over USB (`GARMIN/Activity/*.fit`) | ⏸ Parked | Valid and 100% local, but the computer does not recognise the watch (`Cannot enable. Maybe the USB cable is bad?`): the cable or the port is faulty |
| Gadgetbridge | ⏸ Parked | Fully local, but it replaces Garmin Connect in the watch pairing |

## 2. Garmin Connect Personal API (the chosen option)

- **What it is:** the "Personal" tier of the Garmin Connect Developer Program, opened in October 2026. It is for individuals who want to access their own data: read-only and non-commercial.
- **Key:** created at https://connect.garmin.com/app/settings/personalApiToken → *Create Key*. It expires after 30, 90 or 180 days or 1 year, and it is shown only once.
- **Authentication:**
  1. `POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token` with the header `Authorization: ApiKey <key>`.
  2. The response is the token as plain text (a JWT), not JSON. It lasts at most 24 h, according to its `exp` claim. There is no refresh token: request a new one with the same key.
  3. Data requests carry `Authorization: Bearer <token>`.
- **Endpoints used** (the same as the [official library](https://github.com/garmin/connect-personal-api-python)):
  - `GET /activitylist-service/activities/search/activities?start=&limit=&startDate=&endDate=`: activity list, paginated with `start` and `limit`, dates as `YYYY-MM-DD`.
  - `GET /download-service/files/activity/{activityId}`: a ZIP containing `{id}_ACTIVITY.fit`.
  - `GET /activity-service/activity/{activityId}`: activity detail (not used yet).
- **List metadata:** about 80 fields per activity, including `activityId`, `activityName`, `activityType.typeKey`, `startTimeLocal`, `startTimeGMT`, `distance`, `duration`, `movingDuration`, `elevationGain`, `averageHR`, `maxHR`, `aerobicTrainingEffect`, `activityTrainingLoad`, `hrTimeInZone_1..5`, `fastestSplit_1000/1609/5000`, `startLatitude`, `startLongitude` and `locationName`.
- **Real test (7 Nov 2026):** 5 activities since 25 October, listed and downloaded without errors (3 strength, 1 run, 1 ROUVY indoor ride).
- **To be confirmed:** usage limits (not published), and whether Garmin will eventually strip the FITs from this API too, as it does with those it sends to third parties.

## 3. Which one is the real "original"? FIT comparison

| Comparison | Result |
|---|---|
| Strength, 4 Nov: Personal API ↔ Garmin Connect "Export File" | **Byte-for-byte identical** (same SHA-256, 41,445 bytes) |
| Run, 27 Oct: Personal API ↔ Strava "Export Original" | Same summary, same 2,257 points, HR and GPS, but **120 KB vs 93 KB**: **Strava's file is missing 11 proprietary Garmin message types**, including 2,268 records of type 233 (probably beat-to-beat intervals) |

➡️ **Garmin is a better source than Strava**, even for activities that are already on Strava.

## 4. What each format contains

| | Garmin original FIT | Strava "original" FIT | Strava GPX |
|---|---|---|---|
| 1 Hz points (position, altitude, HR, cadence, temperature) | ✅ | ✅ | ✅ |
| Watch's cumulative distance | ✅ | ✅ | ❌ |
| Laps, session summary, time in zones | ✅ | ✅ | ❌ |
| Training Effect and training load | ✅ | ✅ | ❌ |
| Proprietary messages (possibly HRV…) | ✅ | ❌ | ❌ |
| User profile (weight, height) | ✅ | ✅ | ❌ |

With the GPX alone, distance comes out 1.7% too high (6,730 m vs 6,615 m, due to GPS noise) and elevation gain almost double (+106 m vs +60 m). Both need smoothing.

## 5. Strava's numbers can be reproduced

The FIT reproduces every metric shown on Strava's free website:

- **Summary** (6.61 km · 37:37 · 5:41/km · 60 m · 574 kcal): matches the FIT session summary. Elevation gain is the watch's value.
- **Splits**: the FIT's automatic 1 km laps.
- **Best efforts**: computed from the cumulative distance, they come out identical (400 m 2:03 · ½ mile 4:18 · 1 km 5:27 · 1 mile 8:47 · 5 km 28:06). 2 miles gives 17:56 vs 17:57, a rounding difference.
- **Cadence**: the FIT stores steps per leg, so it must be multiplied by 2 (82 → 164 spm).
- **Only on the Strava website:** segment efforts, Flybys and kudos. Relative Effort, gear, descriptions and photos *are* included in the bulk export (see §10).

More detail in [strava-export-analysis.md](strava-export-analysis.md).

## 6. Other technical details

- **Coordinates in the FIT:** stored as semicircles; degrees = value × 180 / 2³¹.
- **The watch's HR zones:** not reliable. The run's FIT computes them from a lactate threshold of 86 bpm, so everything falls into Z5. The strength FIT uses % of max HR (185) and is consistent. **OpenSport will compute its own zones.**
- **Reading FIT in Python:** `fitdecode` works well. Proprietary messages show up as `unknown_N`.
- **Garmin Connect website:** the internal download uses `gc-api/download-service/files/activity/{id}` with the browser session's tokens. It cannot be reused from a backend.

## 7. Privacy and security

- **Strava's privacy zones do not protect exported files:** the FIT and the GPX contain the full route, including the start near home. OpenSport must trim those sections when **generating** anything that gets shared, not just hide them on screen.
- The FIT contains personal data: weight, height, sex and resting HR.
- The API key lives in `.env` (`600` permissions, outside git). The temporary token is stored in `data/.garmin_token.json` (`600`). `data/` is in `.gitignore`.
- ⚠️ **The current key was pasted into a conversation**: it should be deleted and a new one generated once testing is over.

## 8. Other health sources: Google Health API (Fitbit Air)

- In May 2026 Google launched the **Google Health API** together with the Fitbit Air: about 31 data types (sleep with stages, HR, HRV, SpO₂, respiration, exercise), granular read permissions and webhooks.
- **The old Fitbit Web API lost support on 30 September 2026 and was switched off on 2 November 2026**, so the integration must use the new API. Its schemas differ from Fitbit's and it drops invalid measurements (it returns fewer SpO₂ points).
- **To check:** in "Testing" mode, Google OAuth apps issue refresh tokens that expire after 7 days, and health scopes may require Google's verification. Alternative: Health Connect from the Android app.

## 9. A small LLM to process the data

- **Chosen: Claude Haiku 5.5** (`claude-haiku-5-5`): $0.10 per million input tokens and $0.50 per million output tokens (prompts up to 100K tokens). It supports structured outputs, tools, prompt caching and the Batch API (−50%).
- Estimated cost: about $0.0005 per activity summary, i.e. cents per month for one user.
- Design: the model never receives coordinates or profile data. For questions, it queries our API through tools instead of receiving the whole history. Details in [architecture.md](architecture.md#ai-layer-small-llm-via-api).

## 10. Strava bulk export (checked against the real history)

Export from 7 Nov 2026 (`strava/export_95859`, 370 MB, **outside git**):

| Content | Detail |
|---|---|
| **Activities** | **1,816**, from Jul 2011 to Nov 2026: 827 runs, 307 rides, 236 virtual rides, 183 weight training, 145 walks, 104 rowing, 11 swims and others |
| **Files** | 1,635 `.fit.gz`, 127 `.tcx.gz` and 53 `.gpx`/`.gpx.gz` (one activity has no file) |
| **Volume** | About 6,950 km running, 14,600 km of outdoor cycling and 7,065 km of virtual cycling |
| **`activities.csv`** | 104 columns. Besides the basic numbers: **Relative Effort** (1,721 activities), **gear used** (1,270), **descriptions** (102), **weather** (686), weighted power (441), grade-adjusted distance (693) and perceived exertion (31) |
| **Gear** | Bikes: Canyon Aeroad CFR Disc eTap and Wahoo KICKR Bike Pro. Shoes: New Balance Fresh Foam (820 activities) and Adidas Adizero Boston (137) |
| **Other** | Goals (62), routes (7, as GPX), photos and videos (111), comments, reactions, starred segments, profile, **privacy zones (with address and coordinates)** |
| **Not included** | Segment efforts and leaderboards |

**Correction to what was said at first:** the bulk export **does** include descriptions, photos and gear. The sources consulted back then were outdated or incomplete.

**Cross-check with Garmin for 2026:** 189 activities on Strava and 206 on Garmin. **177 match** by start time (±2 min). The time in `activities.csv` is UTC.
- **Only on Strava (12):** strength and Hyrox sessions (e.g. "GRIT") recorded with another app. The importer must bring them in.
- **Only on Garmin (29):** mostly short ROUVY fragments that never reached Strava.

**How OpenSport uses it:**
1. **History before Garmin** (1,627 activities from 2011 to 2025), with their FIT, TCX or GPX (importer OS-406).
2. **Deduplication** by start time. When they match, Garmin's FIT wins (more complete) and the name, description, gear and photos are kept from Strava.
3. **Gear with its real mileage** from day one (OS-410).
4. **Validation:** Strava's Relative Effort and grade-adjusted distance are used to cross-check our TRIMP and GAP.
5. **Privacy zones:** can be imported as a starting point. ⚠️ They contain the home address: they never leave the server.

## 11. Sources

- Garmin: [Developer Program](https://developer.garmin.com/gc-developer-program/overview/), [Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api/), [official Python library](https://github.com/garmin/connect-personal-api-python)
- [DC Rainmaker: Garmin opens its API](https://www.dcrainmaker.com/2026/10/garmin-connect-api-revamps-connect-developer.html), [the5krunner: Personal API](https://the5krunner.com/2026/10/22/garmin-personal-api/)
- [heise: Strava API becomes paid](https://www.heise.de/en/news/Strava-API-access-only-with-paid-subscription-in-the-future-11315017.html)
- [intervals.icu: API access](https://forum.intervals.icu/t/api-access-to-intervals-icu/609), [garmin-intervals-bridge](https://github.com/futureweb/garmin-intervals-bridge)
- Google Health API: [sleep](https://developers.google.com/health/data-types/sleep), [specifications and migration](https://developers.google.com/health/migration/api-specifications), [Terra's guide](https://tryterra.co/blog/everything-you-need-to-know-about-google-health-new-api)
- [garth abandoned](https://github.com/matin/garth/discussions/222), [Gadgetbridge and Garmin](https://freeyourgadget.codeberg.page/gadgetbridge_org/basics/topics/garmin/)
