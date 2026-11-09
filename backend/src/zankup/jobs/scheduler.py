"""Scheduled work: a Garmin sync every SYNC_INTERVAL_MINUTES (OS-109), the daily backup at
BACKUP_HOUR_UTC (OS-114), hourly health syncs from Garmin and Google Health (OS-602, OS-603; Google's
webhooks bring data sooner when set up, OS-604), Monday's AI report at WEEKLY_REPORT_HOUR_UTC (OS-704)
and pruning of old jobs.

Not a Railway cron service: it would not see the volume with the original FIT files, so the schedule
lives next to the worker. Time is cut into slots of the interval, and each slot's sync job has the slot
in its dedupe key: however many times the API restarts, or however many instances run, there is at
most one sync per slot. The first tick happens at startup, so a deploy also syncs.
"""

from __future__ import annotations

import logging
import threading
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import delete
from sqlalchemy.orm import Session, sessionmaker

from zankup.db.models import Job
from zankup.jobs.queue import enqueue
from zankup.users import ensure_owner

log = logging.getLogger("zankup.jobs")

KEEP_FINISHED = timedelta(days=14)
GARMIN_KEY_WARNING = timedelta(days=14)
TICK_S = 30.0


class Scheduler:
    def __init__(
        self,
        sessions: sessionmaker[Session],
        *,
        interval: timedelta | None,
        owner_email: str,
        backup_hour: int | None = None,
        garmin_key_expires_on: date | None = None,
        garmin_health: bool = False,
        google_health: bool = False,
        weekly_hour: int | None = None,
        tick_s: float = TICK_S,
    ) -> None:
        self.weekly_hour = weekly_hour
        self.garmin_health, self.google_health = garmin_health, google_health
        self.sessions, self.interval, self.owner_email, self.tick_s = sessions, interval, owner_email, tick_s
        self.backup_hour = backup_hour
        self.garmin_key_expires_on = garmin_key_expires_on
        self.stop_event = threading.Event()

    def slot(self, when: datetime) -> int:
        assert self.interval is not None
        return int(when.timestamp() // self.interval.total_seconds())

    def queue_backup(self, session: Session, user_id: int, when: datetime) -> int | None:
        """Today's backup, due at the backup hour; one per day (the day is in the dedupe key)."""
        if self.backup_hour is None:
            return None
        due = when.replace(hour=self.backup_hour, minute=0, second=0, microsecond=0)
        return enqueue(
            session,
            "backup",
            user_id=user_id,
            run_after=max(due, when),
            dedupe_key=f"backup:{when.date().isoformat()}",
            max_attempts=3,
        )

    def warn_garmin_key(self, session: Session, user_id: int, when: datetime) -> None:
        """A notification 14 days before the Garmin Personal API key expires (OS-403), once per key."""
        expires = self.garmin_key_expires_on
        if expires is None or not timedelta(0) <= expires - when.date() <= GARMIN_KEY_WARNING:
            return
        from zankup.notify import notify

        notify(session, user_id, "garmin_key", {"date": expires.isoformat()}, key=f"garmin_key:{expires}")

    def queue_health(self, session: Session, user_id: int, when: datetime) -> list[str]:
        """This hour's health syncs, for the sources that are connected and due."""
        from zankup.health import garmin, google

        hour = when.strftime("%Y%m%d%H")
        queued = []
        for kind, enabled, module in (
            ("garmin_health", self.garmin_health, garmin),
            ("google_health", self.google_health, google),
        ):
            if (
                enabled
                and module.due(session, user_id, when)
                and enqueue(
                    session,
                    f"sync_{kind}",
                    user_id=user_id,
                    payload={"trigger": "cron"},
                    dedupe_key=f"sync:{kind}:{user_id}:h{hour}",
                    max_attempts=2,
                )
            ):
                queued.append(kind)
        return queued

    def queue_weekly(self, session: Session, user_id: int, when: datetime) -> int | None:
        """On Mondays, last week's AI report, due at the weekly hour; one per week (OS-704)."""
        if self.weekly_hour is None:
            return None
        from zankup.ai.weekly import queue_weekly

        return queue_weekly(session, user_id, when, self.weekly_hour)

    def tick(self, when: datetime | None = None) -> int | None:
        """Queue this slot's sync and today's backup if they are not queued yet, and prune old finished
        jobs. Returns the id of the sync job queued, if any."""
        when = when or datetime.now(UTC)
        job_id = backup_id = None
        with self.sessions.begin() as session:
            user_id = ensure_owner(session, self.owner_email).id
            if self.interval is not None:
                job_id = enqueue(
                    session,
                    "sync_garmin",
                    user_id=user_id,
                    payload={"trigger": "cron"},
                    dedupe_key=f"sync:garmin:{user_id}:{self.slot(when)}",
                    max_attempts=2,  # the next slot is a retry anyway
                )
            backup_id = self.queue_backup(session, user_id, when)
            health = self.queue_health(session, user_id, when)
            weekly_id = self.queue_weekly(session, user_id, when)
            self.warn_garmin_key(session, user_id, when)
            pruned = session.execute(
                delete(Job).where(Job.status.in_(("done", "failed")), Job.finished_at < when - KEEP_FINISHED)
            ).rowcount  # type: ignore[attr-defined]
        if job_id is not None:
            log.info("Scheduled sync queued", extra={"job_id": job_id, "slot": self.slot(when)})
        if health:
            log.info("Health syncs queued", extra={"sources": health})
        if backup_id is not None:
            log.info("Daily backup queued", extra={"job_id": backup_id})
        if weekly_id is not None:
            log.info("Weekly report queued", extra={"job_id": weekly_id})
        if pruned:
            log.info("Old jobs pruned", extra={"count": pruned})
        return job_id

    def run_forever(self) -> None:
        interval = self.interval.total_seconds() / 60 if self.interval else None
        log.info("Scheduler started", extra={"interval_min": interval, "backup_hour": self.backup_hour})
        while not self.stop_event.is_set():
            try:
                self.tick()
            except Exception:
                log.exception("Scheduler tick failed")
            self.stop_event.wait(self.tick_s)

    def start_thread(self) -> threading.Thread:
        thread = threading.Thread(target=self.run_forever, name="zankup-scheduler", daemon=True)
        thread.start()
        return thread

    def stop(self) -> None:
        self.stop_event.set()


def build_scheduler() -> Scheduler | None:
    """The scheduler, or None when there is nothing to schedule (no Garmin sync, backups, health or AI)."""
    from zankup.core.config import get_settings
    from zankup.db.session import get_engine

    settings = get_settings()
    syncs = settings.garmin_personal_api_key is not None and settings.sync_interval_minutes > 0
    backups = settings.integrations()["backups"]
    google_health = settings.integrations()["google_health"]
    ai = settings.integrations()["ai"]
    if not syncs and not backups and not google_health and not ai:
        return None
    return Scheduler(
        sessionmaker(get_engine(), expire_on_commit=False),
        interval=timedelta(minutes=settings.sync_interval_minutes) if syncs else None,
        owner_email=settings.owner_email,
        backup_hour=settings.backup_hour_utc if backups else None,
        garmin_key_expires_on=settings.garmin_key_expires_on if syncs else None,
        garmin_health=syncs,
        google_health=google_health,
        weekly_hour=settings.weekly_report_hour_utc if ai else None,
    )
