"""Garmin Personal API client, against scrubbed fixtures (fixtures/garmin, fixtures/fit)."""

import base64
import io
import json
import stat
import zipfile
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import httpx
import pytest
import respx
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from opensport.db.models import User
from opensport.sync.garmin import (
    BASE_URL,
    DOWNLOAD_PATH,
    LIST_PATH,
    PAGE_SIZE,
    TOKEN_PATH,
    AccessToken,
    GarminAuthError,
    GarminClient,
    GarminError,
    MemoryTokenCache,
)
from opensport.sync.tokens import DbTokenCache, FileTokenCache

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
NOW = datetime(2020, 1, 12, 8, 0, tzinfo=UTC)
ACTIVITY_PAGE = json.loads((FIXTURES / "garmin" / "activity-list.json").read_text())
RUN_FIT = (FIXTURES / "fit" / "run.fit").read_bytes()


def fake_jwt(expires: datetime) -> str:
    """An unsigned token shaped like Garmin's (the client only reads `exp`)."""
    part = lambda obj: base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")  # noqa: E731
    return f"{part({'alg': 'none'})}.{part({'exp': int(expires.timestamp())})}.signature"


def client(tokens: MemoryTokenCache | None = None, sleeps: list[float] | None = None) -> GarminClient:
    return GarminClient(
        "test-personal-key",
        tokens or MemoryTokenCache(),
        http=httpx.Client(),
        sleep=(sleeps.append if sleeps is not None else lambda _: None),
        clock=lambda: NOW,
    )


def mock_token(router: respx.Router, expires: datetime = NOW + timedelta(hours=24)) -> respx.Route:
    return router.post(BASE_URL + TOKEN_PATH).mock(return_value=httpx.Response(200, text=fake_jwt(expires)))


@respx.mock
def test_token_is_exchanged_once_and_cached() -> None:
    route = mock_token(respx.mock)
    tokens = MemoryTokenCache()
    garmin = client(tokens)
    first, second = garmin.access_token(), garmin.access_token()
    assert first == second and route.call_count == 1
    assert route.calls[0].request.headers["Authorization"] == "ApiKey test-personal-key"
    assert tokens.token is not None and tokens.token.expires_at == NOW + timedelta(hours=24)


@respx.mock
def test_token_is_renewed_before_it_expires() -> None:
    route = mock_token(respx.mock)
    tokens = MemoryTokenCache()
    tokens.save(AccessToken("old", NOW + timedelta(minutes=2)))  # inside the 5-minute margin
    client(tokens).access_token()
    assert route.call_count == 1


@respx.mock
@pytest.mark.parametrize("status", [401, 403])
def test_rejected_key_raises_auth_error(status: int) -> None:
    respx.post(BASE_URL + TOKEN_PATH).mock(return_value=httpx.Response(status))
    with pytest.raises(GarminAuthError):
        client().access_token()


def test_missing_key_is_an_auth_error() -> None:
    with pytest.raises(GarminAuthError):
        GarminClient("", MemoryTokenCache())


@respx.mock
def test_lists_activities_with_bearer_token_and_dates() -> None:
    mock_token(respx.mock)
    route = respx.get(BASE_URL + LIST_PATH).mock(return_value=httpx.Response(200, json=ACTIVITY_PAGE))
    activities = list(client().list_activities(date(2020, 1, 1)))
    assert [a["activityId"] for a in activities] == [9000000001, 9000000002, 9000000003]
    request = route.calls[0].request
    assert request.headers["Authorization"].startswith("Bearer ")
    assert dict(request.url.params) == {
        "start": "0",
        "limit": str(PAGE_SIZE),
        "startDate": "2020-01-01",
        "endDate": "2020-01-13",
    }


@respx.mock
def test_follows_pages_until_a_short_one() -> None:
    mock_token(respx.mock)
    full_page = [dict(ACTIVITY_PAGE[0], activityId=n) for n in range(PAGE_SIZE)]
    route = respx.get(BASE_URL + LIST_PATH).mock(
        side_effect=[httpx.Response(200, json=full_page), httpx.Response(200, json=ACTIVITY_PAGE)]
    )
    assert len(list(client().list_activities(date(2020, 1, 1)))) == PAGE_SIZE + len(ACTIVITY_PAGE)
    assert [c.request.url.params["start"] for c in route.calls] == ["0", str(PAGE_SIZE)]


@respx.mock
def test_waits_on_429_as_told_and_backs_off_on_5xx() -> None:
    mock_token(respx.mock)
    respx.get(BASE_URL + LIST_PATH).mock(
        side_effect=[
            httpx.Response(429, headers={"Retry-After": "7"}),
            httpx.Response(503),
            httpx.Response(200, json=ACTIVITY_PAGE),
        ]
    )
    sleeps: list[float] = []
    assert len(list(client(sleeps=sleeps).list_activities(date(2020, 1, 1)))) == 3
    assert sleeps == [7.0, 4.0]


@respx.mock
def test_gives_up_after_repeated_server_errors() -> None:
    mock_token(respx.mock)
    respx.get(BASE_URL + LIST_PATH).mock(return_value=httpx.Response(500))
    with pytest.raises(GarminError, match="HTTP 500"):
        list(client().list_activities(date(2020, 1, 1)))


@respx.mock
def test_renews_the_token_once_when_a_data_call_gets_401() -> None:
    token_route = mock_token(respx.mock)
    respx.get(BASE_URL + LIST_PATH).mock(
        side_effect=[httpx.Response(401), httpx.Response(200, json=ACTIVITY_PAGE)]
    )
    assert len(list(client().list_activities(date(2020, 1, 1)))) == 3
    assert token_route.call_count == 2


def _zip(name: str, data: bytes) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(name, data)
    return buffer.getvalue()


@respx.mock
def test_downloads_the_original_fit_from_the_zip() -> None:
    mock_token(respx.mock)
    url = BASE_URL + DOWNLOAD_PATH.format(id=9000000002)
    respx.get(url).mock(return_value=httpx.Response(200, content=_zip("9000000002_ACTIVITY.fit", RUN_FIT)))
    fit = client().download_fit(9000000002)
    assert fit.data == RUN_FIT and fit.filename == "9000000002_ACTIVITY.fit"


@respx.mock
def test_accepts_an_uncompressed_fit_and_rejects_anything_else() -> None:
    mock_token(respx.mock)
    respx.get(BASE_URL + DOWNLOAD_PATH.format(id=1)).mock(return_value=httpx.Response(200, content=RUN_FIT))
    respx.get(BASE_URL + DOWNLOAD_PATH.format(id=2)).mock(return_value=httpx.Response(200, content=b"<html>"))
    assert client().download_fit(1).data == RUN_FIT
    with pytest.raises(GarminError):
        client().download_fit(2)


def test_token_cache_in_the_database(database: str) -> None:
    engine = create_engine(database)
    sessions = sessionmaker(engine, expire_on_commit=False)
    with sessions.begin() as session:
        user = User(email="runner@example.com")
        session.add(user)
    cache = DbTokenCache(sessions, user.id)
    assert cache.load() is None
    cache.save(AccessToken("first", NOW))
    cache.save(AccessToken("second", NOW + timedelta(hours=24)))
    assert cache.load() == AccessToken("second", NOW + timedelta(hours=24))
    engine.dispose()


def test_token_cache_in_a_private_file(tmp_path: Path) -> None:
    cache = FileTokenCache(tmp_path / "state" / "garmin_token.json")
    assert cache.load() is None
    cache.save(AccessToken("token", NOW))
    assert cache.load() == AccessToken("token", NOW)
    assert stat.S_IMODE((tmp_path / "state" / "garmin_token.json").stat().st_mode) == 0o600
