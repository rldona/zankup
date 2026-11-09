"""FastAPI application: health check, sign-in, activities and sync."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Literal

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import Engine

from zankup import __version__
from zankup.api.activities import router as activities_router
from zankup.api.library import router as library_router
from zankup.api.notifications import router as notifications_router
from zankup.api.preferences import router as preferences_router
from zankup.api.profile import router as profile_router
from zankup.api.review import router as review_router
from zankup.api.sharing import public as sharing_public
from zankup.api.sharing import router as sharing_router
from zankup.api.stats import router as stats_router
from zankup.api.sync import router as sync_router
from zankup.api.training import router as training_router
from zankup.api.transfers import direct as transfers_direct
from zankup.api.transfers import router as transfers_router
from zankup.api.week import router as week_router
from zankup.api.wellness import oauth as wellness_oauth
from zankup.api.wellness import router as wellness_router
from zankup.auth.google import router as google_router
from zankup.auth.passkeys import router as passkeys_router
from zankup.auth.password_reset import router as password_router
from zankup.auth.routes import router as auth_router
from zankup.auth.setup import router as setup_router
from zankup.core.config import Settings, get_settings
from zankup.core.logging import configure_logging
from zankup.db.session import database_status, get_engine
from zankup.health.webhooks import router as health_webhooks

log = logging.getLogger("zankup.api")


class Health(BaseModel):
    status: Literal["ok", "degraded"] = Field(description="degraded when the database is unreachable")
    version: str
    database: Literal["ok", "unavailable"]
    schema_revision: str | None = Field(description="Alembic revision applied to the database")


def _announce_setup_code(settings: Settings) -> None:
    """While the instance has no account, log the setup code for /setup (OS-221). Never fatal."""
    from sqlalchemy.orm import Session

    from zankup.auth.setup import announce_setup_code

    try:
        with Session(get_engine()) as db:
            announce_setup_code(db, settings.jwt_secret.get_secret_value() if settings.jwt_secret else None)
    except Exception:
        log.exception("Could not prepare the setup code")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, settings.effective_log_format)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        log.info(
            "Zankup API starting",
            extra={"version": __version__, "environment": settings.environment, **settings.integrations()},
        )
        if settings.environment != "test":
            _announce_setup_code(settings)
        workers = []
        scheduler = None
        if settings.run_worker:
            from zankup.engine.run import ensure_current
            from zankup.jobs.scheduler import build_scheduler
            from zankup.jobs.worker import build_workers

            workers = build_workers()
            ensure_current(workers[0].sessions)  # a new METRICS_VERSION recomputes in the background
            for worker in workers:
                worker.start_thread()  # threads with their own DB connections: requests never wait for jobs
            scheduler = build_scheduler()
            if scheduler is not None:
                scheduler.start_thread()
        yield
        for background in (*workers, scheduler):
            if background is not None:
                background.stop()

    app = FastAPI(
        title="Zankup API",
        version=__version__,
        # Interactive docs only outside production: in production nothing but sign-in is public.
        docs_url=None if settings.is_production else "/api/docs",
        openapi_url=None if settings.is_production else "/api/openapi.json",
        lifespan=lifespan,
    )
    app.include_router(auth_router)
    app.include_router(passkeys_router)
    app.include_router(password_router)
    app.include_router(google_router)
    app.include_router(setup_router)
    app.include_router(library_router)  # before activities: PATCH /api/activities/{id}
    app.include_router(activities_router)
    app.include_router(sharing_router)
    app.include_router(sharing_public)
    app.include_router(transfers_router)
    app.include_router(transfers_direct)
    app.include_router(notifications_router)
    app.include_router(review_router)
    app.include_router(sync_router)
    app.include_router(wellness_router)
    app.include_router(wellness_oauth)
    app.include_router(health_webhooks)
    app.include_router(preferences_router)
    app.include_router(profile_router)
    app.include_router(stats_router)
    app.include_router(training_router)
    app.include_router(week_router)

    # Uploads and downloads go straight to the API host (api/transfers.py): the app's origins may call
    # those paths from the browser. Never with cookies, which keep working only through the proxy.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.rstrip("/") for o in settings.webauthn_origins],
        allow_methods=["GET", "PUT"],
        allow_headers=["Content-Type"],
        allow_credentials=False,
        max_age=3600,
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
