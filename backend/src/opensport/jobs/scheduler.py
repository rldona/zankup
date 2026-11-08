"""Scheduled work (OS-109): queue a Garmin sync every SYNC_INTERVAL_MINUTES and prune old jobs.

Not a Railway cron service: it would not see the volume with the original FIT files, so the schedule
lives next to the worker. Time is cut into slots of the interval, and each slot's sync job has the slot
in its dedupe key: however many times the API restarts, or however many instances run, there is at
most one sync per slot. The first tick happens at startup, so a deploy also syncs.
"""

from __future__ import annotations

import logging
import threading
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete
from sqlalchemy.orm import Session, sessionmaker

from opensport.db.models import Job
from opensport.jobs.queue import enqueue
from opensport.users import ensure_owner

log = logging.getLogger("opensport.jobs")

KEEP_FINISHED = timedelta(days=14)
TICK_S = 30.0


class Scheduler:
    def __init__(
        self,
        sessions: sessionmaker[Session],
        *,
        interval: timedelta,
        owner_email: str,
        tick_s: float = TICK_S,
    ) -> None:
        self.sessions, self.interval, self.owner_email, self.tick_s = sessions, interval, owner_email, tick_s
        self.stop_event = threading.Event()

    def slot(self, when: datetime) -> int:
        return int(when.timestamp() // self.interval.total_seconds())

    def tick(self, when: datetime | None = None) -> int | None:
        """Queue this slot's sync if it is not queued yet and prune old finished jobs. Returns the job id."""
        when = when or datetime.now(UTC)
        with self.sessions.begin() as session:
            user_id = ensure_owner(session, self.owner_email).id
            job_id = enqueue(
                session,
                "sync_garmin",
                user_id=user_id,
                payload={"trigger": "cron"},
                dedupe_key=f"sync:garmin:{user_id}:{self.slot(when)}",
                max_attempts=2,  # the next slot is a retry anyway
            )
            pruned = session.execute(
                delete(Job).where(Job.status.in_(("done", "failed")), Job.finished_at < when - KEEP_FINISHED)
            ).rowcount  # type: ignore[attr-defined]
        if job_id is not None:
            log.info("Scheduled sync queued", extra={"job_id": job_id, "slot": self.slot(when)})
        if pruned:
            log.info("Old jobs pruned", extra={"count": pruned})
        return job_id

    def run_forever(self) -> None:
        log.info("Scheduler started", extra={"interval_min": self.interval.total_seconds() / 60})
        while not self.stop_event.is_set():
            try:
                self.tick()
            except Exception:
                log.exception("Scheduler tick failed")
            self.stop_event.wait(self.tick_s)

    def start_thread(self) -> threading.Thread:
        thread = threading.Thread(target=self.run_forever, name="opensport-scheduler", daemon=True)
        thread.start()
        return thread

    def stop(self) -> None:
        self.stop_event.set()


def build_scheduler() -> Scheduler | None:
    """The scheduler, or None when automatic syncs are off (no Garmin key, or an interval of 0)."""
    from opensport.core.config import get_settings
    from opensport.db.session import get_engine

    settings = get_settings()
    if settings.garmin_personal_api_key is None or settings.sync_interval_minutes == 0:
        return None
    return Scheduler(
        sessionmaker(get_engine(), expire_on_commit=False),
        interval=timedelta(minutes=settings.sync_interval_minutes),
        owner_email=settings.owner_email,
    )
