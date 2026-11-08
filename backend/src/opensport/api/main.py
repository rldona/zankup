"""FastAPI application. Only the health check exists until the activities API (OS-111)."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Literal

from fastapi import Depends, FastAPI
from pydantic import BaseModel, Field
from sqlalchemy import Engine

from opensport import __version__
from opensport.core.config import Settings, get_settings
from opensport.core.logging import configure_logging
from opensport.db.session import database_status, get_engine

log = logging.getLogger("opensport.api")


class Health(BaseModel):
    status: Literal["ok", "degraded"] = Field(description="degraded when the database is unreachable")
    version: str
    database: Literal["ok", "unavailable"]
    schema_revision: str | None = Field(description="Alembic revision applied to the database")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, settings.effective_log_format)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        log.info(
            "OpenSport API starting",
            extra={"version": __version__, "environment": settings.environment, **settings.integrations()},
        )
        worker = None
        if settings.run_worker:
            from opensport.jobs.worker import build_worker

            worker = build_worker()
            worker.start_thread()  # a thread with its own DB connections: requests never wait for jobs
        yield
        if worker is not None:
            worker.stop()

    app = FastAPI(
        title="OpenSport API",
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    @app.get("/api/health", operation_id="getHealth")
    def health(engine: Annotated[Engine, Depends(get_engine)]) -> Health:
        """Liveness and database check, used by Railway on deploy and by the PWA through the Vercel proxy.

        Always 200: a database outage is reported as `degraded`, so the API itself stays observable.
        """
        reachable, revision = database_status(engine)
        if not reachable:
            log.warning("Database unreachable from the health check")
        return Health(
            status="ok" if reachable else "degraded",
            version=__version__,
            database="ok" if reachable else "unavailable",
            schema_revision=revision,
        )

    return app


app = create_app()
