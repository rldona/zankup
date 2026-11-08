"""What each job kind does. A handler gets a session (committed by the worker with the job) and the job."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from opensport.db.models import Job
from opensport.ingest import ingest_fit
from opensport.storage import RawStore

Handler = Callable[[Session, Job], None]


def ingest_stored_fit(store: RawStore) -> Handler:
    """Import a FIT file that is already in the raw store (downloaded by the sync, OS-108).

    Payload: source, external_id, key, optional meta (source metadata) and reprocess.
    """

    def handle(session: Session, job: Job) -> None:
        payload: dict[str, Any] = job.payload
        ingest_fit(
            session,
            store,
            user_id=job.user_id,
            source=payload["source"],
            external_id=str(payload["external_id"]),
            fit=store.get(payload["key"]),
            meta=payload.get("meta"),
            reprocess=bool(payload.get("reprocess", False)),
        )

    return handle


def default_handlers(store: RawStore) -> dict[str, Handler]:
    return {"ingest_fit": ingest_stored_fit(store)}
