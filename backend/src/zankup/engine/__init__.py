"""The historical computation engine (phase 3, OS-313 and OS-314).

Screens never compute: they read what the engine leaves in its tables. Importing an activity queues
`metrics_activity` (its own metrics, records and segment efforts), which queues one `metrics_user`
(daily load, estimates, matched routes and events) for the whole batch. Changing a setting the
metrics depend on, or a new METRICS_VERSION, queues `metrics_full`, which redoes everything from
the stored series with its progress visible in the app. Everything is idempotent.
"""

METRICS_VERSION = 1
