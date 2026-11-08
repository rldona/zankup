"""The worker: claims due jobs and runs their handlers, one at a time.

It runs inside the API process as a background thread (Railway volumes attach to one service only, and
the raw FIT files live on the API's volume), or on its own with `python -m opensport.jobs.worker`.
Each job runs in its own transaction together with its completion, so a crash never leaves half-done
work marked as done; a failure rolls back and is recorded in a separate transaction.
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

from sqlalchemy.orm import Session, sessionmaker

from opensport.db.models import Job
from opensport.jobs.handlers import Handler
from opensport.jobs.queue import claim, complete, fail, now, requeue_stale

log = logging.getLogger("opensport.jobs")

POLL_INTERVAL_S = 2.0
STALE_CHECK_EVERY = timedelta(minutes=5)


class Worker:
    def __init__(
        self,
        sessions: sessionmaker[Session],
        handlers: dict[str, Handler],
        *,
        name: str | None = None,
        poll_interval_s: float = POLL_INTERVAL_S,
    ) -> None:
        self.sessions, self.handlers = sessions, handlers
        self.name = name or f"{socket.gethostname()}:{os.getpid()}:{threading.get_ident()}"
        self.poll_interval_s = poll_interval_s
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
        return True

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
        thread = threading.Thread(target=self.run_forever, name="opensport-worker", daemon=True)
        thread.start()
        return thread

    def stop(self) -> None:
        self.stop_event.set()


def build_worker() -> Worker:
    from opensport.core.config import get_settings
    from opensport.db.session import get_engine
    from opensport.jobs.handlers import default_handlers
    from opensport.storage import get_raw_store

    sessions = sessionmaker(get_engine(), expire_on_commit=False)
    return Worker(sessions, default_handlers(get_raw_store(get_settings())))


def main() -> None:
    from opensport.core.config import get_settings
    from opensport.core.logging import configure_logging

    settings = get_settings()
    configure_logging(settings.log_level, settings.effective_log_format)
    worker = build_worker()
    signal.signal(signal.SIGTERM, lambda *_: worker.stop())
    signal.signal(signal.SIGINT, lambda *_: worker.stop())
    worker.run_forever()


if __name__ == "__main__":
    main()
