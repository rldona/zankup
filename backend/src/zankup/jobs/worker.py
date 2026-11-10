"""The workers: each claims due jobs of its kinds and runs their handlers, one at a time.

They run inside the API process as background threads (Railway volumes attach to one service only, and
the raw FIT files live on the API's volume), or on their own with `python -m zankup.jobs.worker`.
Two of them (OS-226): one for long jobs (Garmin syncs, which can take hours for a whole history, and
backups) and one for imports, so the files a long sync downloads are imported while it goes on.

Each job runs in its own transaction together with its completion, so a crash never leaves half-done
work marked as done; a failure rolls back and is recorded in a separate transaction. While a job runs,
a heartbeat keeps its `locked_at` fresh, so a long job is never taken for one whose worker died.
"""

from __future__ import annotations

import logging
import os
import signal
import socket
import threading
import time
import traceback
from datetime import datetime, timedelta

from sqlalchemy import update
from sqlalchemy.orm import Session, sessionmaker

from zankup.db.models import Job
from zankup.jobs.handlers import Handler
from zankup.jobs.queue import claim, complete, fail, now, requeue_stale

log = logging.getLogger("zankup.jobs")

POLL_INTERVAL_S = 2.0
STALE_CHECK_EVERY = timedelta(minutes=5)
HEARTBEAT_S = 60.0
LONG_KINDS = frozenset(
    {
        "sync_garmin",
        "sync_garmin_health",
        "sync_google_health",
        "backup",
        "metrics_full",
        "import_upload",
        "export",
    }
)


class Worker:
    def __init__(
        self,
        sessions: sessionmaker[Session],
        handlers: dict[str, Handler],
        *,
        name: str | None = None,
        poll_interval_s: float = POLL_INTERVAL_S,
        heartbeat_s: float = HEARTBEAT_S,
    ) -> None:
        self.sessions, self.handlers = sessions, handlers
        self.name = name or f"{socket.gethostname()}:{os.getpid()}:{threading.get_ident()}"
        self.poll_interval_s = poll_interval_s
        self.heartbeat_s = heartbeat_s
        self.stop_event = threading.Event()
        self._last_stale_check: datetime | None = None

    def run_once(self) -> bool:
        """Process one due job. Returns False when there was nothing to do."""
        self._maybe_requeue_stale()
        with self.sessions() as session:
            job = claim(session, self.name, list(self.handlers))
            session.commit()
            if job is None:
                return False
            job_id, kind = job.id, job.kind

        started = time.monotonic()
        done = threading.Event()
        beat = threading.Thread(target=self._heartbeat, args=(job_id, done), daemon=True)
        beat.start()
        try:
            with self.sessions() as session:
                job = session.get_one(Job, job_id)
                self.handlers[kind](session, job)
                complete(session, job)
                session.commit()
            log.info(
                "Job done",
                extra={"job_id": job_id, "kind": kind, "ms": round((time.monotonic() - started) * 1000)},
            )
        except Exception as error:
            with self.sessions() as session:
                job = session.get_one(Job, job_id)
                retry = fail(
                    session, job, f"{error.__class__.__name__}: {error}\n{traceback.format_exc(limit=5)}"
                )
                session.commit()
            log.warning(
                "Job failed" + (", will retry" if retry else ", giving up"),
                extra={"job_id": job_id, "kind": kind, "error": str(error)[:200]},
            )
        finally:
            done.set()
            beat.join(timeout=5)
        return True

    def _heartbeat(self, job_id: int, done: threading.Event) -> None:
        """Every `heartbeat_s` while the job runs: "still alive" (a fresh locked_at)."""
        while not done.wait(self.heartbeat_s):
            try:
                with self.sessions.begin() as session:
                    session.execute(
                        update(Job)
                        .where(Job.id == job_id, Job.status == "running", Job.locked_by == self.name)
                        .values(locked_at=now())
                    )
            except Exception:
                log.exception("Job heartbeat failed", extra={"job_id": job_id})

    def _maybe_requeue_stale(self) -> None:
        if self._last_stale_check and now() - self._last_stale_check < STALE_CHECK_EVERY:
            return
        self._last_stale_check = now()
        with self.sessions.begin() as session:
            count = requeue_stale(session)
        if count:
            log.warning("Requeued stale jobs", extra={"count": count})

    def run_forever(self) -> None:
        log.info("Worker started", extra={"worker": self.name, "kinds": sorted(self.handlers)})
        while not self.stop_event.is_set():
            try:
                busy = self.run_once()
            except Exception:
                log.exception("Worker loop error")
                busy = False
            if not busy:
                self.stop_event.wait(self.poll_interval_s)
        log.info("Worker stopped", extra={"worker": self.name})

    def start_thread(self) -> threading.Thread:
        thread = threading.Thread(target=self.run_forever, name=f"zankup-worker-{self.name}", daemon=True)
        thread.start()
        return thread

    def stop(self) -> None:
        self.stop_event.set()


def split(handlers: dict[str, Handler]) -> tuple[dict[str, Handler], dict[str, Handler]]:
    """The handlers for long jobs and for the rest (imports)."""
    long = {kind: handler for kind, handler in handlers.items() if kind in LONG_KINDS}
    short = {kind: handler for kind, handler in handlers.items() if kind not in LONG_KINDS}
    return long, short


def build_workers() -> list[Worker]:
    """A worker for long jobs and one for imports, sharing the connection pool."""
    from zankup.alerts import email_sender
    from zankup.core.config import get_settings
    from zankup.db.session import get_engine
    from zankup.jobs.handlers import default_handlers
    from zankup.storage import get_raw_store

    settings = get_settings()
    sessions = sessionmaker(get_engine(), expire_on_commit=False)
    # No Garmin key here: the handlers read it for each job, so one saved from the apps works at once.
    handlers = default_handlers(get_raw_store(settings), sessions, None, email_sender(settings), settings)
    base = f"{socket.gethostname()}:{os.getpid()}"
    return [
        Worker(sessions, kinds, name=f"{base}:{label}")
        for label, kinds in zip(("long", "imports"), split(handlers), strict=True)
        if kinds
    ]


def main() -> None:
    from zankup.core.config import get_settings
    from zankup.core.logging import configure_logging

    settings = get_settings()
    configure_logging(settings.log_level, settings.effective_log_format)
    from zankup.jobs.scheduler import build_scheduler

    *others, last = build_workers()
    scheduler = build_scheduler()

    def stop(*_: object) -> None:
        for worker in (*others, last):
            worker.stop()
        if scheduler is not None:
            scheduler.stop()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    if scheduler is not None:
        scheduler.start_thread()
    for worker in others:
        worker.start_thread()
    last.run_forever()


if __name__ == "__main__":
    main()
