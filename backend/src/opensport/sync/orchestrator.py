"""Garmin sync orchestrator (OS-108).

One run: take the sync lock, list the activities since the last successful sync (with a day of overlap),
download the FIT of each one that is not imported yet into the raw store, and queue an `ingest_fit` job
for it. The worker (OS-115) does the parsing and writing. Progress and the outcome are recorded in a
`sync_runs` row, which the Sync button polls (OS-112). The button creates that row up front (status
`queued`) and passes its id, so the client can poll it before the worker picks the job up.

Incremental and idempotent: activities already imported or already queued are skipped, so a second run
right after the first does nothing. Only one sync runs at a time per user (a Postgres advisory lock).
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session, sessionmaker

from opensport.db.models import Activity, Job, Source, SyncRun
from opensport.jobs.queue import enqueue
from opensport.storage import RawStore, raw_key
from opensport.sync.garmin import GarminClient

log = logging.getLogger("opensport.sync")

SOURCE = "garmin"
FIRST_SYNC_DAYS = 30  # the full history is a separate, deliberate load (OS-113)
OVERLAP = timedelta(days=1)
LOCK_NAMESPACE = 0x05_9E_C0  # advisory lock key = namespace + user id


class SyncAlreadyRunning(RuntimeError):
    pass


@dataclass(frozen=True)
class SyncResult:
    run_id: int
    listed: int
    queued: int
    skipped: int


def ingest_dedupe_key(user_id: int, external_id: str) -> str:
    return f"ingest:{user_id}:{SOURCE}:{external_id}"


@contextmanager
def sync_lock(sessions: sessionmaker[Session], user_id: int) -> Iterator[None]:
    """Hold a session-level advisory lock for the whole run, on its own connection."""
    with sessions() as session:
        connection = session.connection()
        key = LOCK_NAMESPACE * 1_000_000 + user_id
        if not connection.scalar(text("SELECT pg_try_advisory_lock(:k)"), {"k": key}):
            raise SyncAlreadyRunning(f"A sync is already running for user {user_id}")
        try:
            yield
        finally:
            connection.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": key})
            session.commit()


def _start_date(session: Session, user_id: int, since: date | None) -> date:
    if since is not None:
        return since
    last = session.scalar(select(Source.last_sync_at).where(Source.user_id == user_id, Source.kind == SOURCE))
    if last is None:
        return datetime.now(UTC).date() - timedelta(days=FIRST_SYNC_DAYS)
    return (last - OVERLAP).date()


def _known_ids(session: Session, user_id: int) -> set[str]:
    imported = session.scalars(
        select(Activity.external_id).where(Activity.user_id == user_id, Activity.source == SOURCE)
    )
    queued = session.scalars(
        select(Job.dedupe_key).where(Job.user_id == user_id, Job.kind == "ingest_fit", Job.status != "failed")
    )
    prefix = ingest_dedupe_key(user_id, "")
    return set(imported) | {key.removeprefix(prefix) for key in queued if key and key.startswith(prefix)}


def _progress(sessions: sessionmaker[Session], run_id: int, **values: Any) -> None:
    with sessions.begin() as session:
        run = session.get_one(SyncRun, run_id)
        run.progress = {**(run.progress or {}), **values}


def run_sync(
    sessions: sessionmaker[Session],
    store: RawStore,
    garmin: GarminClient,
    *,
    user_id: int,
    trigger: str = "cron",
    since: date | None = None,
    run_id: int | None = None,
    pause_s: float = 1.0,
    sleep: Callable[[float], None] = time.sleep,
) -> SyncResult:
    """Run one sync, recorded in a new `sync_runs` row or in `run_id` (a queued run).

    Raises SyncAlreadyRunning if another one holds the lock.
    """
    with sync_lock(sessions, user_id):
        with sessions.begin() as session:
            if run_id is None:
                run = SyncRun(user_id=user_id, trigger=trigger, status="running", progress={})
                session.add(run)
                session.flush()
                run_id = run.id
            else:
                run = session.get_one(SyncRun, run_id)
                run.status, run.started_at, run.progress, run.error = "running", datetime.now(UTC), {}, None
            start = _start_date(session, user_id, since)
            known = _known_ids(session, user_id)
        log.info("Sync started", extra={"run_id": run_id, "trigger": trigger, "since": start.isoformat()})

        try:
            listed = list(garmin.list_activities(start))
            new = [a for a in reversed(listed) if str(a["activityId"]) not in known]  # oldest first
            _progress(
                sessions, run_id, listed=len(listed), new=len(new), downloaded=0, since=start.isoformat()
            )
            for done, activity in enumerate(new, start=1):
                external_id = str(activity["activityId"])
                fit = garmin.download_fit(int(external_id))
                key = raw_key(user_id, SOURCE, external_id)
                store.put(key, fit.data)
                with sessions.begin() as session:
                    enqueue(
                        session,
                        "ingest_fit",
                        user_id=user_id,
                        payload={"source": SOURCE, "external_id": external_id, "key": key, "meta": activity},
                        dedupe_key=ingest_dedupe_key(user_id, external_id),
                    )
                    run = session.get_one(SyncRun, run_id)
                    run.new_count = done
                    run.progress = {**(run.progress or {}), "downloaded": done}
                if done < len(new):
                    sleep(pause_s)
        except Exception as error:
            with sessions.begin() as session:
                run = session.get_one(SyncRun, run_id)
                run.status, run.finished_at, run.error = "error", datetime.now(UTC), str(error)[:2000]
            log.error("Sync failed", extra={"run_id": run_id, "error": str(error)[:200]})
            raise

        with sessions.begin() as session:
            run = session.get_one(SyncRun, run_id)
            run.status, run.finished_at, run.new_count = "success", datetime.now(UTC), len(new)
            source = session.scalar(select(Source).where(Source.user_id == user_id, Source.kind == SOURCE))
            if source is None:
                source = Source(user_id=user_id, kind=SOURCE)
                session.add(source)
            source.last_sync_at = datetime.now(UTC)
        log.info("Sync finished", extra={"run_id": run_id, "listed": len(listed), "queued": len(new)})
        return SyncResult(run_id, len(listed), len(new), len(listed) - len(new))
