"""Garmin sync orchestrator (OS-108).

One run: take the sync lock, list the activities since the last successful sync (with a day of overlap),
download the FIT of each one that is not imported yet into the raw store, and queue an `ingest_fit` job
for it. The worker (OS-115) does the parsing and writing. Progress and the outcome are recorded in a
`sync_runs` row, which the Sync button polls (OS-112). The button creates that row up front (status
`queued`) and passes its id, so the client can poll it before the worker picks the job up.

Incremental and idempotent: activities already imported or already queued are skipped, so a second run
right after the first does nothing. Only one sync runs at a time per user (a Postgres advisory lock).

Long ranges (the initial history load, OS-113) are listed in windows of WINDOW_DAYS, oldest first, and
each window is downloaded and queued before the next is listed: imports start straight away, progress
is visible per window, and an interrupted load resumes where it stopped (what is queued is skipped).
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

from zankup.alerts import Sender, notify_sync_outcome
from zankup.db.models import Activity, Job, Source, SyncRun
from zankup.jobs.queue import enqueue
from zankup.storage import RawStore, raw_key
from zankup.sync.garmin import GarminClient, NoFitFile

log = logging.getLogger("zankup.sync")

SOURCE = "garmin"
FIRST_SYNC_DAYS = 30  # the full history is a separate, deliberate load (OS-113)
OVERLAP = timedelta(days=1)
LOCK_NAMESPACE = 0x05_9E_C0  # advisory lock key = namespace + user id
WINDOW_DAYS = 180


class SyncAlreadyRunning(RuntimeError):
    pass


@dataclass(frozen=True)
class SyncResult:
    run_id: int
    listed: int
    queued: int
    skipped: int
    no_fit: int = 0


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


def history_windows(start: date, end: date, days: int = WINDOW_DAYS) -> list[tuple[date, date]]:
    """Consecutive, non-overlapping [first, last] date windows covering start..end, oldest first."""
    windows, first = [], start
    while first <= end:
        last = min(first + timedelta(days=days - 1), end)
        windows.append((first, last))
        first = last + timedelta(days=1)
    return windows


def _known_ids(session: Session, user_id: int) -> set[str]:
    imported = session.scalars(
        select(Activity.external_id).where(Activity.user_id == user_id, Activity.source == SOURCE)
    )
    queued = session.scalars(
        select(Job.dedupe_key).where(Job.user_id == user_id, Job.kind == "ingest_fit", Job.status != "failed")
    )
    prefix = ingest_dedupe_key(user_id, "")
    return (
        set(imported)
        | {key.removeprefix(prefix) for key in queued if key and key.startswith(prefix)}
        | _no_fit_ids(session, user_id)
    )


def _no_fit_ids(session: Session, user_id: int) -> set[str]:
    """Activities Garmin has no FIT for (manual, or GPX/TCX uploads): remembered, never downloaded again."""
    cursor = session.scalar(
        select(Source.sync_cursor).where(Source.user_id == user_id, Source.kind == SOURCE)
    )
    return set((cursor or {}).get("no_fit", []))


def _remember_no_fit(sessions: sessionmaker[Session], user_id: int, external_id: str) -> None:
    with sessions.begin() as session:
        source = session.scalar(select(Source).where(Source.user_id == user_id, Source.kind == SOURCE))
        if source is None:
            source = Source(user_id=user_id, kind=SOURCE)
            session.add(source)
        cursor = dict(source.sync_cursor or {})
        cursor["no_fit"] = sorted({*cursor.get("no_fit", []), external_id})
        source.sync_cursor = cursor


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
    alert: Sender | None = None,
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

        seen: set[str] = set()
        queued = no_fit = 0
        try:
            windows = history_windows(start, datetime.now(UTC).date() + timedelta(days=1), WINDOW_DAYS)
            _progress(
                sessions,
                run_id,
                since=start.isoformat(),
                listed=0,
                new=0,
                downloaded=0,
                window=0,
                windows=len(windows),
            )
            for index, (first, last) in enumerate(windows, start=1):
                page = [a for a in garmin.list_activities(first, last) if str(a["activityId"]) not in seen]
                seen.update(str(a["activityId"]) for a in page)
                new = [a for a in reversed(page) if str(a["activityId"]) not in known]  # oldest first
                _progress(sessions, run_id, listed=len(seen), new=queued + len(new), window=index)
                for activity in new:
                    if queued:
                        sleep(pause_s)  # between downloads: a personal API key, no rush
                    external_id = str(activity["activityId"])
                    try:
                        fit = garmin.download_fit(int(external_id))
                    except NoFitFile as missing:
                        log.warning(
                            "Activity without a FIT file skipped",
                            extra={"external_id": external_id, "files": missing.files},
                        )
                        _remember_no_fit(sessions, user_id, external_id)
                        known.add(external_id)
                        no_fit += 1
                        _progress(sessions, run_id, no_fit=no_fit)
                        continue
                    key = raw_key(user_id, SOURCE, external_id)
                    store.put(key, fit.data)
                    known.add(external_id)
                    queued += 1
                    with sessions.begin() as session:
                        enqueue(
                            session,
                            "ingest_fit",
                            user_id=user_id,
                            payload={
                                "source": SOURCE,
                                "external_id": external_id,
                                "key": key,
                                "meta": activity,
                            },
                            dedupe_key=ingest_dedupe_key(user_id, external_id),
                        )
                        run = session.get_one(SyncRun, run_id)
                        run.new_count = queued
                        run.progress = {**(run.progress or {}), "downloaded": queued}
        except BaseException as error:  # also Ctrl+C on a long load: the run must not stay "running"
            message = str(error) or error.__class__.__name__
            with sessions.begin() as session:
                run = session.get_one(SyncRun, run_id)
                run.status, run.finished_at, run.error = "error", datetime.now(UTC), message[:2000]
            log.error("Sync failed", extra={"run_id": run_id, "error": message[:200]})
            with sessions() as session:
                notify_sync_outcome(session, user_id, alert)
            raise

        with sessions.begin() as session:
            run = session.get_one(SyncRun, run_id)
            run.status, run.finished_at, run.new_count = "success", datetime.now(UTC), queued
            source = session.scalar(select(Source).where(Source.user_id == user_id, Source.kind == SOURCE))
            if source is None:
                source = Source(user_id=user_id, kind=SOURCE)
                session.add(source)
            source.last_sync_at = datetime.now(UTC)
        log.info(
            "Sync finished", extra={"run_id": run_id, "listed": len(seen), "queued": queued, "no_fit": no_fit}
        )
        with sessions() as session:
            notify_sync_outcome(session, user_id, alert)
        return SyncResult(run_id, len(seen), queued, len(seen) - queued - no_fit, no_fit)
