from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from zankup import __version__
from zankup.api.main import app
from zankup.db.session import get_engine


def test_health_reports_the_migrated_database(database: str) -> None:
    engine = create_engine(database)
    app.dependency_overrides[get_engine] = lambda: engine
    try:
        body = TestClient(app).get("/api/health").json()
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
    assert body["status"] == "ok" and body["database"] == "ok" and body["version"] == __version__
    assert body["schema_revision"] is not None


def test_health_reports_an_empty_database(empty_database: str) -> None:
    engine = create_engine(empty_database)
    app.dependency_overrides[get_engine] = lambda: engine
    try:
        body = TestClient(app).get("/api/health").json()
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
    assert body["database"] == "ok" and body["schema_revision"] is None


def test_health_is_degraded_without_database() -> None:
    engine = create_engine(
        "postgresql+psycopg://nobody:nothing@127.0.0.1:9/none", connect_args={"connect_timeout": 1}
    )
    app.dependency_overrides[get_engine] = lambda: engine
    try:
        response = TestClient(app).get("/api/health")
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
    assert response.status_code == 200
    assert response.json() == {
        "status": "degraded",
        "version": __version__,
        "database": "unavailable",
        "schema_revision": None,
    }
