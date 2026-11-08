"""A job queue in Postgres, without extra infrastructure.

- `enqueue` adds a job, optionally with a dedupe key so the same work is never queued twice.
- `claim` takes the next due job with `FOR UPDATE SKIP LOCKED`, so several workers never take the
  same job and never wait for each other.
- `complete` and `fail` close it; a failure is retried with exponential backoff until `max_attempts`.
- `requeue_stale` gives back jobs whose worker died mid-run (locked for longer than `stale_after`).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from zankup.db.models import Job

BACKOFF_BASE = timedelta(seconds=30)
BACKOFF_MAX = timedelta(hours=1)
STALE_AFTER = timedelta(minutes=15)


def now() -> datetime:
    return datetime.now(UTC)


def backoff(attempt: int) -> timedelta:
    """30 s, 1 min, 2 min, 4 min… capped at one hour."""
    delay: timedelta = BACKOFF_BASE * (2 ** max(attempt - 1, 0))
    return min(delay, BACKOFF_MAX)


def enqueue(
    session: Session,
    kind: str,
    *,
    user_id: int,
    payload: dict[str, Any] | None = None,
    run_after: datetime | None = None,
    dedupe_key: str | None = None,
    max_attempts: int = 5,
) -> int | None:
    """Queue a job and return its id, or None if a job with the same dedupe key already exists."""
    statement = (
        insert(Job)
        .values(
            kind=kind,
            user_id=user_id,
            payload=payload or {},
            run_after=run_after or now(),
            dedupe_key=dedupe_key,
            max_attempts=max_attempts,
        )
        .on_conflict_do_nothing(index_elements=["dedupe_key"])
        .returning(Job.id)
    )
    return session.scalar(statement)


def claim(session: Session, worker: str, kinds: list[str] | None = None) -> Job | None:
    """Lock and return the next due job, marking it running. The caller commits."""
    query = (
        select(Job)
        .where(Job.status == "queued", Job.run_after <= now())
        .order_by(Job.run_after, Job.id)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if kinds:
        query = query.where(Job.kind.in_(kinds))
    job = session.scalar(query)
    if job is None:
        return None
    job.status, job.locked_by, job.locked_at = "running", worker, now()
    job.attempts += 1
    session.flush()
    return job


def complete(session: Session, job: Job) -> None:
    job.status, job.finished_at, job.locked_by, job.locked_at = "done", now(), None, None
    job.last_error = None


def fail(session: Session, job: Job, error: str) -> bool:
    """Record a failure. Returns True if the job will be retried, False if it gave up."""
    job.last_error = error[:2000]
    job.locked_by, job.locked_at = None, None
    if job.attempts < job.max_attempts:
        job.status, job.run_after = "queued", now() + backoff(job.attempts)
        return True
    job.status, job.finished_at = "failed", now()
    return False


def requeue_stale(session: Session, stale_after: timedelta = STALE_AFTER) -> int:
    """Put back jobs left running by a worker that died. Returns how many."""
    result = session.execute(
        update(Job)
        .where(Job.status == "running", or_(Job.locked_at.is_(None), Job.locked_at < now() - stale_after))
        .values(status="queued", locked_by=None, locked_at=None, run_after=now())
    )
    return result.rowcount or 0  # type: ignore[attr-defined]
