"""What each job kind does. A handler gets a session (committed by the worker with the job) and the job."""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from zankup.alerts import Sender
from zankup.core.config import Settings
from zankup.db.models import Job
from zankup.ingest import ingest_fit
from zankup.storage import RawStore

log = logging.getLogger("zankup.jobs")

Handler = Callable[[Session, Job], None]


def ingest_stored_fit(store: RawStore) -> Handler:
    """Import a FIT file that is already in the raw store (downloaded by the sync, OS-108).

    Payload: source, external_id, key, optional meta (source metadata) and reprocess.
    """

    def handle(session: Session, job: Job) -> None:
        payload: dict[str, Any] = job.payload
        ingest_fit(
            session,
            store,
            user_id=job.user_id,
            source=payload["source"],
            external_id=str(payload["external_id"]),
            fit=store.get(payload["key"]),
            meta=payload.get("meta"),
            reprocess=bool(payload.get("reprocess", False)),
        )

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
    return handlers
