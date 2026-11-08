"""FastAPI application. Only the health check exists until the activities API (OS-111)."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from pydantic import BaseModel

from opensport import __version__
from opensport.core.config import Settings, get_settings
from opensport.core.logging import configure_logging

log = logging.getLogger("opensport.api")


class Health(BaseModel):
    status: str
    version: str


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, settings.effective_log_format)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        log.info(
            "OpenSport API starting",
            extra={"version": __version__, "environment": settings.environment, **settings.integrations()},
        )
        yield

    app = FastAPI(
        title="OpenSport API",
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    @app.get("/api/health", operation_id="getHealth")
    def health() -> Health:
        """Liveness check used by Railway and by the PWA through the Vercel proxy."""
        return Health(status="ok", version=__version__)

    return app


app = create_app()
