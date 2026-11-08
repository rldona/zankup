"""FastAPI application. Only the health check exists until the activities API (OS-111)."""

from fastapi import FastAPI
from pydantic import BaseModel

from opensport import __version__

app = FastAPI(
    title="OpenSport API", version=__version__, docs_url="/api/docs", openapi_url="/api/openapi.json"
)


class Health(BaseModel):
    status: str
    version: str


@app.get("/api/health", operation_id="getHealth")
def health() -> Health:
    """Liveness check used by Railway and by the PWA through the Vercel proxy."""
    return Health(status="ok", version=__version__)
