"""FastAPI application. Only the health check exists until the activities API (OS-111)."""

from fastapi import FastAPI

from opensport import __version__

app = FastAPI(
    title="OpenSport API", version=__version__, docs_url="/api/docs", openapi_url="/api/openapi.json"
)


@app.get("/api/health")
def health() -> dict[str, str]:
    """Liveness check used by Railway and by the PWA through the Vercel proxy."""
    return {"status": "ok", "version": __version__}
