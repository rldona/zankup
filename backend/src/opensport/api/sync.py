"""The Sync button (OS-112): start a Garmin sync now and follow its progress.

`POST /api/sync` records a `queued` run and queues the job for the worker, then answers at once with
the run, which the client polls with `GET /api/sync/{id}` until it is `success` or `error`. Pressing
the button while a sync is queued or running returns that sync instead of starting another one.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from opensport.api.routing import protected_router
from opensport.auth.deps import AppSettings, CurrentUser, DbSession
from opensport.db.models import Job, SyncRun
from opensport.jobs.queue import enqueue

router = protected_router(prefix="/api/sync", tags=["sync"])

ACTIVE_FOR = timedelta(minutes=30)  # a queued or running run older than this is not waited for


class SyncProgress(BaseModel):
    since: str | None = Field(None, description="First day asked to the source (YYYY-MM-DD)")
    listed: int | None = Field(None, description="Activities the source returned")
    new: int | None = Field(None, description="Of those, not imported yet")
    downloaded: int | None = Field(None, description="Original files downloaded so far")


class SyncStatus(BaseModel):
    id: int
    trigger: Literal["cron", "button", "initial", "import"]
    status: Literal["queued", "running", "success", "error"]
    started_at: datetime
    finished_at: datetime | None
    new_count: int = Field(description="New activities found and queued for import")
    progress: SyncProgress
    pending_imports: int = Field(description="Activities downloaded but not imported yet (all runs)")
    error: str | None


def _pending_imports(db: DbSession, user_id: int) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(Job)
            .where(Job.user_id == user_id, Job.kind == "ingest_fit", Job.status.in_(("queued", "running")))
        )
        or 0
    )


def _status(run: SyncRun, pending: int) -> SyncStatus:
    return SyncStatus(
        id=run.id,
        trigger=run.trigger,
        status=run.status,
        started_at=run.started_at,
        finished_at=run.finished_at,
        new_count=run.new_count,
        progress=SyncProgress.model_validate(run.progress or {}),
        pending_imports=pending,
        error=run.error,
    )


@router.post(
    "",
    operation_id="startSync",
    status_code=status.HTTP_202_ACCEPTED,
    responses={409: {"description": "Garmin is not configured on this instance"}},
)
def start_sync(db: DbSession, user: CurrentUser, settings: AppSettings, response: Response) -> SyncStatus:
    """Sync Garmin now. Returns the new run, or the one already queued or running."""
    if settings.garmin_personal_api_key is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Garmin is not configured on this instance")
    active = db.scalar(
        select(SyncRun)
        .where(
            SyncRun.user_id == user.id,
            SyncRun.status.in_(("queued", "running")),
            SyncRun.started_at > datetime.now(UTC) - ACTIVE_FOR,
        )
        .order_by(SyncRun.started_at.desc())
        .limit(1)
    )
    if active is not None:
        response.status_code = status.HTTP_200_OK
        return _status(active, _pending_imports(db, user.id))

    run = SyncRun(user_id=user.id, trigger="button", status="queued", progress={})
    db.add(run)
    db.flush()
    enqueue(
        db,
        "sync_garmin",
        user_id=user.id,
        payload={"trigger": "button", "run_id": run.id},
        dedupe_key=f"sync:garmin:{user.id}:run:{run.id}",
    )
    db.commit()
    return _status(run, _pending_imports(db, user.id))


@router.get("", operation_id="listSyncs")
def list_syncs(
    db: DbSession, user: CurrentUser, limit: Annotated[int, Query(ge=1, le=50)] = 10
) -> list[SyncStatus]:
    """Latest runs, newest first: when the last sync happened and how it went."""
    runs = db.scalars(
        select(SyncRun)
        .where(SyncRun.user_id == user.id)
        .order_by(SyncRun.started_at.desc(), SyncRun.id.desc())
        .limit(limit)
    )
    pending = _pending_imports(db, user.id)
    return [_status(run, pending) for run in runs]


@router.get("/{run_id}", operation_id="getSync")
def get_sync(run_id: int, db: DbSession, user: CurrentUser) -> SyncStatus:
    """One run and its progress. Poll it every couple of seconds while it is queued or running."""
    run = db.scalar(select(SyncRun).where(SyncRun.id == run_id, SyncRun.user_id == user.id))
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sync not found")
    return _status(run, _pending_imports(db, user.id))
