from fastapi.testclient import TestClient

from opensport import __version__
from opensport.api.main import app


def test_health_returns_ok() -> None:
    response = TestClient(app).get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": __version__}
