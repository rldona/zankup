"""What each job kind does. A handler gets a session (committed by the worker with the job) and the job."""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from zankup.alerts import Sender
from zankup.core.config import Settings
from zankup.db.models import Job
from zankup.ingest import ingest_file
from zankup.storage import RawStore

log = logging.getLogger("zankup.jobs")

Handler = Callable[[Session, Job], None]


RECENT = timedelta(days=2)  # only these are "new": a history backfill never notifies


def notify_new_activity(session: Session, user_id: int, activity_id: int) -> None:
    from zankup.db.models import Activity
    from zankup.notify import notify

    activity = session.get(Activity, activity_id)
    if activity is None or datetime.now(UTC) - activity.start_utc > RECENT:
        return
    notify(
        session,
        user_id,
        "activity",
        {
            "activity_id": activity.id,
            "name": activity.name,
            "distance_m": activity.distance_m,
            "duration_s": activity.moving_s or activity.duration_s,
        },
        key=f"activity:{activity.id}",
    )


def ingest_stored_fit(store: RawStore) -> Handler:
    """Import a FIT file that is already in the raw store (downloaded by the sync, OS-108).

    Payload: source, external_id, key, optional meta (source metadata) and reprocess.
    """

    def handle(session: Session, job: Job) -> None:
        payload: dict[str, Any] = job.payload
        key = str(payload["key"])
        result = ingest_file(
            session,
            store,
            user_id=job.user_id,
            source=payload["source"],
            external_id=str(payload["external_id"]),
            data=store.get(key),
            fmt=key.rsplit(".", 1)[-1] if key.endswith((".tcx", ".gpx")) else "fit",
            meta=payload.get("meta"),
            reprocess=bool(payload.get("reprocess", False)),
        )
        if result.created or result.merged:
            notify_new_activity(session, job.user_id, result.activity_id)

    return handle


def sync_garmin(
    sessions: sessionmaker[Session], store: RawStore, api_key: str, alert: Sender | None = None
) -> Handler:
    """Run a Garmin sync (OS-108) for the job's user.

    Payload: optional trigger, since (YYYY-MM-DD) and run_id (a `queued` run created by the Sync button,
    OS-112). The sync manages its own transactions.

    - Scheduled syncs: a sync already in progress is not an error (the next slot catches up).
    - Button syncs: if another sync holds the lock, the job is retried shortly, so the run the client is
      polling still happens; a sync that fails is recorded on the run and not retried (the user sees the
      error and can press again).
    """
    from datetime import UTC, date, datetime

    from zankup.db.models import SyncRun
    from zankup.sync.garmin import GarminClient
    from zankup.sync.orchestrator import SyncAlreadyRunning, run_sync
    from zankup.sync.tokens import DbTokenCache

    def give_up(run_id: int, error: str) -> None:
        with sessions.begin() as session:
            run = session.get(SyncRun, run_id)
            if run is not None and run.status in ("queued", "running"):
                run.status, run.finished_at, run.error = "error", datetime.now(UTC), error

    def handle(_: Session, job: Job) -> None:
        since = job.payload.get("since")
        run_id = job.payload.get("run_id")
        garmin = GarminClient(api_key, DbTokenCache(sessions, job.user_id))
        try:
            run_sync(
                sessions,
                store,
                garmin,
                user_id=job.user_id,
                trigger=str(job.payload.get("trigger", "cron")),
                since=date.fromisoformat(since) if since else None,
                run_id=int(run_id) if run_id is not None else None,
                alert=alert,
            )
        except SyncAlreadyRunning:
            if run_id is None:
                log.info("Sync skipped: another one is running", extra={"job_id": job.id})
                return
            if job.attempts < job.max_attempts:
                raise  # the worker retries it with backoff once the other sync is done
            give_up(int(run_id), "Another sync kept running; try again later")
        except Exception as error:
            if run_id is None:
                raise
            give_up(int(run_id), str(error)[:2000])  # run_sync has usually recorded it already
            log.warning("Button sync failed", extra={"job_id": job.id, "error": str(error)[:200]})

    return handle


def backup(settings: Settings, alert: Sender | None = None) -> Handler:
    """The daily backup (OS-114). On its last failed attempt it e-mails the owner."""
    from zankup.backup import backup_store, run_backup

    def handle(_: Session, job: Job) -> None:
        store = backup_store(settings)
        if store is None:
            log.info("Backup skipped: not configured", extra={"job_id": job.id})
            return
        try:
            run_backup(settings, store)
        except Exception as error:
            if job.attempts >= job.max_attempts and alert is not None:
                try:
                    alert(
                        "Zankup: the daily backup failed",
                        f"The daily backup failed {job.attempts} times today and will try again "
                        f"tomorrow.\n\nError:\n{str(error)[:2000]}",
                    )
                except Exception:
                    log.exception("Could not send the backup alert")
            raise

    return handle


def default_handlers(
    store: RawStore,
    sessions: sessionmaker[Session] | None = None,
    garmin_api_key: str | None = None,
    alert: Sender | None = None,
    settings: Settings | None = None,
) -> dict[str, Handler]:
    from zankup.engine import run as engine

    handlers: dict[str, Handler] = {
        "ingest_fit": ingest_stored_fit(store),
        "metrics_activity": engine.metrics_activity,
        "metrics_user": engine.metrics_user,
        "segment_search": engine.segment_search,
    }
    if sessions is not None:
        handlers["metrics_full"] = engine.metrics_full(sessions)
    if sessions is not None and garmin_api_key:
        handlers["sync_garmin"] = sync_garmin(sessions, store, garmin_api_key, alert)
    if settings is not None:
        handlers["backup"] = backup(settings, alert)
        from zankup.notify import push_handler

        handlers["push"] = push_handler(settings)
    if settings is not None and sessions is not None:
        handlers["import_upload"] = import_upload(sessions, store, settings)
        handlers["export"] = export(sessions, store, settings)
    return handlers


def import_upload(sessions: sessionmaker[Session], store: RawStore, settings: Settings) -> Handler:
    """Import an uploaded file or archive (OS-404, OS-406). Payload: import_id."""
    from zankup.api.transfers import upload_path
    from zankup.importer import run_import
    from zankup.photos import get_photo_store

    def handle(_: Session, job: Job) -> None:
        import_id = int(job.payload["import_id"])
        run_import(sessions, store, get_photo_store(settings), import_id, upload_path(settings, import_id))

    return handle


def export(sessions: sessionmaker[Session], store: RawStore, settings: Settings) -> Handler:
    """Write a ZIP with all of a user's data (OS-411). Payload: export_id."""
    from zankup.api.transfers import export_dir
    from zankup.exporter import run_export
    from zankup.photos import get_photo_store

    def handle(_: Session, job: Job) -> None:
        run_export(
            sessions, store, get_photo_store(settings), export_dir(settings), int(job.payload["export_id"])
        )

    return handle
