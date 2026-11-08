"""What each job kind does. A handler gets a session (committed by the worker with the job) and the job."""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from opensport.db.models import Job
from opensport.ingest import ingest_fit
from opensport.storage import RawStore

log = logging.getLogger("opensport.jobs")

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


def sync_garmin(sessions: sessionmaker[Session], store: RawStore, api_key: str) -> Handler:
    """Run a Garmin sync (OS-108) for the job's user.

    Payload: optional trigger, since (YYYY-MM-DD) and run_id (a `queued` run created by the Sync button,
    OS-112). The sync manages its own transactions.

    - Scheduled syncs: a sync already in progress is not an error (the next slot catches up).
    - Button syncs: if another sync holds the lock, the job is retried shortly, so the run the client is
      polling still happens; a sync that fails is recorded on the run and not retried (the user sees the
      error and can press again).
    """
    from datetime import UTC, date, datetime

    from opensport.db.models import SyncRun
    from opensport.sync.garmin import GarminClient
    from opensport.sync.orchestrator import SyncAlreadyRunning, run_sync
    from opensport.sync.tokens import DbTokenCache

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


def default_handlers(
    store: RawStore, sessions: sessionmaker[Session] | None = None, garmin_api_key: str | None = None
) -> dict[str, Handler]:
    handlers = {"ingest_fit": ingest_stored_fit(store)}
    if sessions is not None and garmin_api_key:
        handlers["sync_garmin"] = sync_garmin(sessions, store, garmin_api_key)
    return handlers
