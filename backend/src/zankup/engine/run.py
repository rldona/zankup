"""The engine's jobs and how they are queued (OS-313, OS-314)."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import exists, func, select, update
from sqlalchemy.orm import Session, sessionmaker

from zankup.db.models import Activity, ActivityMetrics, EngineRun, Job, Segment
from zankup.engine import METRICS_VERSION
from zankup.engine.activity import record_events, update_activity
from zankup.engine.athlete import athlete
from zankup.engine.segments import search_activity, search_segment
from zankup.engine.user import update_user
from zankup.jobs.queue import enqueue

log = logging.getLogger("zankup.engine")

BATCH = timedelta(seconds=5)  # imports in a burst share one user-level recompute


def _pending(db: Session, kind: str, user_id: int) -> bool:
    return bool(
        db.scalar(select(exists().where(Job.kind == kind, Job.user_id == user_id, Job.status == "queued")))
    )


def queue_activity(db: Session, user_id: int, activity_id: int) -> None:
    enqueue(db, "metrics_activity", user_id=user_id, payload={"activity_id": activity_id})


def queue_user(db: Session, user_id: int) -> None:
    if not _pending(db, "metrics_user", user_id):
        enqueue(db, "metrics_user", user_id=user_id, run_after=datetime.now(UTC) + BATCH)


def queue_full(db: Session, user_id: int, reason: str) -> None:
    """Recompute everything (a setting the metrics use changed, or a new METRICS_VERSION)."""
    if not _pending(db, "metrics_full", user_id):
        enqueue(db, "metrics_full", user_id=user_id, payload={"reason": reason}, max_attempts=3)


def queue_segment(db: Session, user_id: int, segment_id: int) -> None:
    enqueue(db, "segment_search", user_id=user_id, payload={"segment_id": segment_id})


def outdated_users(db: Session) -> list[int]:
    """Users with activities the current METRICS_VERSION has not computed."""
    return list(
        db.scalars(
            select(Activity.user_id)
            .outerjoin(ActivityMetrics, ActivityMetrics.activity_id == Activity.id)
            .where(
                (ActivityMetrics.activity_id.is_(None)) | (ActivityMetrics.metrics_version < METRICS_VERSION)
            )
            .distinct()
        )
    )


def ensure_current(sessions: sessionmaker[Session]) -> None:
    """On start: a full recomputation for whoever has activities this version has not computed."""
    with sessions.begin() as db:
        for user_id in outdated_users(db):
            queue_full(db, user_id, f"metrics version {METRICS_VERSION}")


def metrics_activity(db: Session, job: Job) -> None:
    activity = db.get(Activity, int(job.payload["activity_id"]))
    if activity is None:
        return
    update_activity(db, activity, athlete(db, activity.user_id))
    record_events(db, activity)
    search_activity(db, activity)
    queue_user(db, activity.user_id)


def metrics_user(db: Session, job: Job) -> None:
    update_user(db, job.user_id)


def segment_search(db: Session, job: Job) -> None:
    segment = db.get(Segment, int(job.payload["segment_id"]))
    if segment is not None:
        search_segment(db, segment)


def metrics_full(sessions: sessionmaker[Session]):  # type: ignore[no-untyped-def]
    """Recompute the whole history, committing as it goes so the app can show progress."""

    def handle(_: Session, job: Job) -> None:
        user_id = job.user_id
        with sessions.begin() as db:
            ids = list(
                db.scalars(
                    select(Activity.id).where(Activity.user_id == user_id).order_by(Activity.start_utc)
                )
            )
            run = EngineRun(
                user_id=user_id,
                reason=str(job.payload.get("reason", "")),
                total=len(ids),
                done=0,
                metrics_version=METRICS_VERSION,
            )
            db.add(run)
            db.flush()
            run_id = run.id
            db.execute(
                update(ActivityMetrics).where(ActivityMetrics.user_id == user_id).values(route_group=None)
            )
        try:
            with sessions() as db:
                who = athlete(db, user_id)
            for start in range(0, len(ids), 25):
                with sessions.begin() as db:
                    for activity_id in ids[start : start + 25]:
                        activity = db.get(Activity, activity_id)
                        if activity is not None:
                            update_activity(db, activity, who)
                    db.get_one(EngineRun, run_id).done = min(len(ids), start + 25)
            with sessions.begin() as db:
                update_user(db, user_id)
                # With FTP and LTHR estimated, zones that depend on them are now right.
                who = athlete(db, user_id)
            if who.ftp or who.zone_method == "lthr":
                for start in range(0, len(ids), 100):
                    with sessions.begin() as db:
                        for activity_id in ids[start : start + 100]:
                            activity = db.get(Activity, activity_id)
                            if activity is not None:
                                update_activity(db, activity, who)
            with sessions.begin() as db:
                for segment in db.scalars(select(Segment).where(Segment.user_id == user_id)):
                    search_segment(db, segment)
                run = db.get_one(EngineRun, run_id)
                run.status, run.finished_at = "success", datetime.now(UTC)
            log.info("Metrics recomputed", extra={"user_id": user_id, "activities": len(ids)})
        except Exception as error:
            with sessions.begin() as db:
                run = db.get_one(EngineRun, run_id)
                run.status, run.finished_at, run.error = "error", datetime.now(UTC), str(error)[:2000]
            raise

    return handle


def progress(db: Session, user_id: int) -> EngineRun | None:
    """The latest full recomputation, for the "recomputing" notice."""
    return db.scalar(
        select(EngineRun).where(EngineRun.user_id == user_id).order_by(EngineRun.started_at.desc()).limit(1)
    )


def counts(db: Session, user_id: int) -> tuple[int, int]:
    total = db.scalar(select(func.count()).select_from(Activity).where(Activity.user_id == user_id)) or 0
    done = (
        db.scalar(
            select(func.count())
            .select_from(ActivityMetrics)
            .where(ActivityMetrics.user_id == user_id, ActivityMetrics.metrics_version == METRICS_VERSION)
        )
        or 0
    )
    return total, done
