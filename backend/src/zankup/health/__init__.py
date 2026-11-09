"""Health data from several sources (phase 6).

- `store`: saving sleep sessions and daily figures, with Zankup's own sleep score (OS-601).
- `garmin`: sleep, HRV, resting HR and steps from the Garmin Personal API (OS-602).
- `google`: the Google Health API (Fitbit Air and other Google devices), OAuth and sync (OS-603).
- `webhooks`: Google Health's new-data notifications, signature checked (OS-604).
- `resolve`: one value per day and metric when several sources have it, and readiness (OS-605, OS-606).
- `crypto`: the sources' long-lived credentials, encrypted at rest.
"""
