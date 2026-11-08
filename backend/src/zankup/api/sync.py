"""The Sync button (OS-112): start a Garmin sync now and follow its progress.

`POST /api/sync` records a `queued` run and queues the job for the worker, then answers at once with
the run, which the client polls with `GET /api/sync/{id}` until it is `success` or `error`. Pressing
the button while a sync is queued or running returns that sync instead of starting another one.

With `{"history": true}` (OS-226) it loads the whole Garmin history, window by window, as a
background job: closing the tab does not stop it, and starting it again resumes (what is already
imported is skipped).
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal

from fastapi import HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from zankup.api.routing import protected_router
from zankup.auth.deps import AppSettings, CurrentUser, DbSession
from zankup.db.models import Job, SyncRun
from zankup.jobs.queue import enqueue

router = protected_router(prefix="/api/sync", tags=["sync"])

ACTIVE_FOR = timedelta(minutes=30)  # a queued or running run older than this is not waited for
HISTORY_ACTIVE_FOR = timedelta(hours=24)  # a whole history can take hours
HISTORY_SINCE = date(2000, 1, 1)


class SyncRequest(BaseModel):
    history: bool = Field(False, description="Load the whole history (from 2000), not just what is new")
    since: date | None = Field(None, description="Or load from this day on")


class SyncProgress(BaseModel):
    since: str | None = Field(None, description="First day asked to the source (YYYY-MM-DD)")
    listed: int | None = Field(None, description="Activities the source returned")
    new: int | None = Field(None, description="Of those, not imported yet")
    downloaded: int | None = Field(None, description="Original files downloaded so far")
    window: int | None = Field(None, description="Date window being listed (long loads go window by window)")
    windows: int | None = Field(None, description="How many date windows the run covers")
    no_fit: int | None = Field(None, description="Skipped: no FIT original (manual, or GPX/TCX uploads)")


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
def start_sync(
    db: DbSession,
    user: CurrentUser,
    settings: AppSettings,
    response: Response,
    body: SyncRequest | None = None,
) -> SyncStatus:
    """Sync Garmin now (or load its whole history). Returns the new run, or the one already going."""
    if settings.garmin_personal_api_key is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Garmin is not configured on this instance")
    request = body or SyncRequest()
    now = datetime.now(UTC)
    active = db.scalar(
        select(SyncRun)
        .where(
            SyncRun.user_id == user.id,
            SyncRun.status.in_(("queued", "running")),
            (SyncRun.started_at > now - ACTIVE_FOR)
            | ((SyncRun.trigger == "initial") & (SyncRun.started_at > now - HISTORY_ACTIVE_FOR)),
        )
        .order_by(SyncRun.started_at.desc())
        .limit(1)
    )
    if active is not None:
        response.status_code = status.HTTP_200_OK
        return _status(active, _pending_imports(db, user.id))

    since = HISTORY_SINCE if request.history else request.since
    trigger = "initial" if since else "button"
    run = SyncRun(user_id=user.id, trigger=trigger, status="queued", progress={})
    db.add(run)
    db.flush()
    enqueue(
        db,
        "sync_garmin",
        user_id=user.id,
        payload={"trigger": trigger, "run_id": run.id} | ({"since": since.isoformat()} if since else {}),
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
