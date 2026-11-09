"""Imports (OS-404, OS-406) and exports (OS-411): the large files going in and out.

Uploads and downloads can be hundreds of megabytes (a Strava export of 15 years is ~370 MB), so they
do not go through the web proxy, which limits request sizes and bills for the traffic: the signed-in
app asks for an import or an export through the proxy, as usual, and gets a short-lived signed URL on
the API host itself (`API_PUBLIC_URL`) for the bytes.

Uploads arrive in parts of `PART_SIZE`, each written at its offset, so a dropped connection only
repeats one part. When all the bytes are there, `finish` queues the import job.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from zankup.api.routing import protected_router
from zankup.auth.deps import AppSettings, CurrentUser, DbSession
from zankup.auth.security import create_grant, read_grant
from zankup.core.config import Settings
from zankup.db.models import ExportRow, ImportRow
from zankup.jobs.queue import enqueue

router = protected_router(tags=["transfers"])
direct = APIRouter(prefix="/api/direct", tags=["transfers"])

PART_SIZE = 4 * 1024 * 1024  # under the web proxy's 4.5 MB request limit, for when API_PUBLIC_URL is unset
MAX_UPLOAD = 4 * 1024 * 1024 * 1024
UPLOAD_TTL = timedelta(hours=12)
DOWNLOAD_TTL = timedelta(hours=1)
EXPORT_KEEP = timedelta(days=7)


def upload_path(settings: Settings, import_id: int) -> Path:
    return settings.data_dir / "uploads" / f"{import_id}.upload"


def export_dir(settings: Settings) -> Path:
    return settings.data_dir / "exports"


def _secret(settings: Settings) -> str | None:
    return settings.jwt_secret.get_secret_value() if settings.jwt_secret else None


def _base(settings: Settings) -> str:
    return (settings.api_public_url or "").rstrip("/")


# --- imports ---------------------------------------------------------------------------------------


class ImportCreate(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    size: int = Field(gt=0, le=MAX_UPLOAD)


class ImportProblem(BaseModel):
    file: str
    error: str


class ImportOut(BaseModel):
    id: int
    kind: str | None
    status: str = Field(description="uploading, queued, running, done or error")
    filename: str
    size: int
    received: int
    total: int
    processed: int
    created: int
    merged: int
    skipped: int
    failed: int
    photos: int
    errors: list[ImportProblem]
    error: str | None
    created_at: datetime
    finished_at: datetime | None


class UploadTarget(BaseModel):
    url: str = Field(description="PUT each part to <url>/<index>?token=<token>")
    token: str
    part_size: int


class NewImport(BaseModel):
    import_: ImportOut = Field(alias="import")
    upload: UploadTarget

    model_config = {"populate_by_name": True}


def _import_out(row: ImportRow) -> ImportOut:
    return ImportOut(
        id=row.id,
        kind=row.kind,
        status=row.status,
        filename=row.filename,
        size=row.size,
        received=row.received,
        total=row.total,
        processed=row.processed,
        created=row.created,
        merged=row.merged,
        skipped=row.skipped,
        failed=row.failed,
        photos=row.photos,
        errors=[ImportProblem(**e) for e in row.errors or []],
        error=row.error,
        created_at=row.created_at,
        finished_at=row.finished_at,
    )


def _own_import(db: DbSession, user_id: int, import_id: int) -> ImportRow:
    row = db.scalar(select(ImportRow).where(ImportRow.id == import_id, ImportRow.user_id == user_id))
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Import not found")
    return row


@router.post("/api/imports", operation_id="createImport", status_code=201, response_model_by_alias=True)
def create_import(body: ImportCreate, db: DbSession, user: CurrentUser, settings: AppSettings) -> NewImport:
    """Start an upload: a FIT, TCX or GPX file, a ZIP of them, a Garmin export or a Strava export."""
    name = os.path.basename(body.filename.replace("\\", "/"))[:255] or "upload"
    row = ImportRow(user_id=user.id, filename=name, size=body.size)
    db.add(row)
    db.commit()
    path = upload_path(settings, row.id)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as file:
        file.truncate(body.size)
    token = create_grant("upload", user.id, _secret(settings), UPLOAD_TTL, imp=row.id)
    return NewImport(
        import_=_import_out(row),
        upload=UploadTarget(
            url=f"{_base(settings)}/api/direct/uploads/{row.id}", token=token, part_size=PART_SIZE
        ),
    )


@direct.put(
    "/uploads/{import_id}/{index}",
    operation_id="uploadPart",
    status_code=204,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}},
        }
    },
)
async def upload_part(
    import_id: int, index: int, request: Request, db: DbSession, settings: AppSettings, token: str = Query()
) -> Response:
    """One part of an upload, authorised by the token `createImport` returned."""
    grant = read_grant(token, _secret(settings), "upload")
    if grant is None or grant.get("imp") != import_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "This upload link is not valid")
    row = db.get(ImportRow, import_id)
    if row is None or row.status != "uploading" or str(row.user_id) != grant["sub"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "This upload is not waiting for data")
    offset = index * PART_SIZE
    if index < 0 or offset >= row.size:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Part out of range")
    expected = min(PART_SIZE, row.size - offset)
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > expected:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Part too large")
    if len(data) != expected:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Part {index} must be {expected} bytes")
    with upload_path(settings, import_id).open("r+b") as file:
        file.seek(offset)
        file.write(data)
    row.received = max(
        row.received, offset + len(data)
    )  # parts are sent in order; a retry is not counted twice
    db.commit()
    return Response(status_code=204)


@router.post("/api/imports/{import_id}/finish", operation_id="finishImport")
def finish_import(import_id: int, db: DbSession, user: CurrentUser) -> ImportOut:
    """Every part is uploaded: queue the import."""
    row = _own_import(db, user.id, import_id)
    if row.status != "uploading":
        return _import_out(row)
    if row.received < row.size:
        raise HTTPException(status.HTTP_409_CONFLICT, "The upload is not complete")
    row.status = "queued"
    enqueue(
        db,
        "import_upload",
        user_id=user.id,
        payload={"import_id": row.id},
        max_attempts=1,
        dedupe_key=f"import:{row.id}",
    )
    db.commit()
    return _import_out(row)


@router.get("/api/imports", operation_id="listImports")
def list_imports(db: DbSession, user: CurrentUser) -> list[ImportOut]:
    rows = db.scalars(
        select(ImportRow).where(ImportRow.user_id == user.id).order_by(ImportRow.created_at.desc()).limit(30)
    )
    return [_import_out(r) for r in rows]


@router.get("/api/imports/{import_id}", operation_id="getImport")
def get_import(import_id: int, db: DbSession, user: CurrentUser) -> ImportOut:
    return _import_out(_own_import(db, user.id, import_id))


@router.delete("/api/imports/{import_id}", operation_id="deleteImport", status_code=204)
def delete_import(import_id: int, db: DbSession, user: CurrentUser, settings: AppSettings) -> Response:
    """Cancel an upload, or remove a finished import from the list (its activities stay)."""
    row = _own_import(db, user.id, import_id)
    if row.status in ("queued", "running"):
        raise HTTPException(status.HTTP_409_CONFLICT, "The import is running")
    upload_path(settings, row.id).unlink(missing_ok=True)
    db.delete(row)
    db.commit()
    return Response(status_code=204)


# --- exports ---------------------------------------------------------------------------------------


class ExportOut(BaseModel):
    id: int
    status: str = Field(description="queued, running, done or error")
    size: int | None
    error: str | None
    created_at: datetime
    finished_at: datetime | None
    expires_at: datetime | None
    download_url: str | None = Field(description="Valid for an hour, when the export is done")


def _export_out(row: ExportRow, settings: Settings) -> ExportOut:
    url = None
    if row.status == "done" and row.path:
        token = create_grant("download", row.user_id, _secret(settings), DOWNLOAD_TTL, exp_id=row.id)
        url = f"{_base(settings)}/api/direct/exports/{row.id}?token={token}"
    return ExportOut(
        id=row.id,
        status=row.status,
        size=row.size,
        error=row.error,
        created_at=row.created_at,
        finished_at=row.finished_at,
        expires_at=row.expires_at,
        download_url=url,
    )


def remove_expired(db: DbSession, settings: Settings, user_id: int | None = None) -> None:
    query = select(ExportRow).where(ExportRow.expires_at < datetime.now(UTC))
    if user_id is not None:
        query = query.where(ExportRow.user_id == user_id)
    for row in db.scalars(query):
        if row.path:
            (export_dir(settings) / row.path).unlink(missing_ok=True)
        db.delete(row)


@router.post("/api/exports", operation_id="createExport", status_code=201)
def create_export(db: DbSession, user: CurrentUser, settings: AppSettings) -> ExportOut:
    """Prepare a ZIP with all your data: the original files, photos and everything else as JSON."""
    remove_expired(db, settings, user.id)
    running = db.scalar(
        select(ExportRow).where(ExportRow.user_id == user.id, ExportRow.status.in_(("queued", "running")))
    )
    if running is not None:
        return _export_out(running, settings)
    row = ExportRow(user_id=user.id)
    db.add(row)
    db.flush()
    enqueue(
        db,
        "export",
        user_id=user.id,
        payload={"export_id": row.id},
        max_attempts=2,
        dedupe_key=f"export:{row.id}",
    )
    db.commit()
    return _export_out(row, settings)


@router.get("/api/exports", operation_id="listExports")
def list_exports(db: DbSession, user: CurrentUser, settings: AppSettings) -> list[ExportOut]:
    rows = db.scalars(
        select(ExportRow).where(ExportRow.user_id == user.id).order_by(ExportRow.created_at.desc()).limit(5)
    )
    now = datetime.now(UTC)
    return [_export_out(r, settings) for r in rows if r.expires_at is None or r.expires_at > now]


@direct.get(
    "/exports/{export_id}",
    operation_id="downloadExport",
    response_class=FileResponse,
    responses={200: {"content": {"application/zip": {"schema": {"type": "string", "format": "binary"}}}}},
)
def download_export(
    export_id: int, db: DbSession, settings: AppSettings, token: str = Query()
) -> FileResponse:
    grant = read_grant(token, _secret(settings), "download")
    if grant is None or grant.get("exp_id") != export_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "This download link has expired")
    row = db.get(ExportRow, export_id)
    if row is None or row.status != "done" or not row.path or str(row.user_id) != grant["sub"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Export not found")
    path = export_dir(settings) / row.path
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Export not found")
    day = row.created_at.date().isoformat()
    return FileResponse(path, media_type="application/zip", filename=f"zankup-export-{day}.zip")
