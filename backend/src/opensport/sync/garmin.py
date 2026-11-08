"""Client for the Garmin Connect Personal API (OS-103).

Flow: the personal key is exchanged for a 24 h access token (cached), activities are listed page by page
and each original FIT is downloaded as a ZIP. Endpoints and behaviour are documented in docs/findings.md.

The client is synchronous on purpose: it runs in the sync job, one request at a time, pausing between
downloads. It retries 429 (honouring Retry-After) and 5xx with backoff, and renews the token once if a
data request returns 401.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import time
import zipfile
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Protocol

import httpx

log = logging.getLogger("opensport.sync.garmin")

BASE_URL = "https://personal.connectapi.garmin.com"
TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token"
LIST_PATH = "/activitylist-service/activities/search/activities"
DOWNLOAD_PATH = "/download-service/files/activity/{id}"
USER_AGENT = "OpenSport (self-hosted; https://github.com/rldona/OpenSport)"

PAGE_SIZE = 50
MAX_ATTEMPTS = 4
MAX_RETRY_AFTER_S = 120.0
TOKEN_MARGIN = timedelta(minutes=5)  # renew a token this long before it expires


class GarminError(RuntimeError):
    """The Personal API answered with something we cannot use."""


class GarminAuthError(GarminError):
    """The personal key was rejected (revoked, expired or mistyped)."""


@dataclass(frozen=True)
class AccessToken:
    value: str
    expires_at: datetime

    def valid(self, now: datetime) -> bool:
        return self.expires_at - TOKEN_MARGIN > now


class TokenCache(Protocol):
    """Where the access token lives between runs (the database in production, see db_token_cache)."""

    def load(self) -> AccessToken | None: ...

    def save(self, token: AccessToken) -> None: ...


class MemoryTokenCache:
    def __init__(self) -> None:
        self.token: AccessToken | None = None

    def load(self) -> AccessToken | None:
        return self.token

    def save(self, token: AccessToken) -> None:
        self.token = token


def token_expiry(token: str, now: datetime) -> datetime:
    """Expiry from the JWT `exp` claim (not verified: we only need to know when to renew)."""
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return datetime.fromtimestamp(float(json.loads(base64.urlsafe_b64decode(payload))["exp"]), UTC)
    except (IndexError, KeyError, ValueError):
        return now + timedelta(hours=1)  # unreadable: renew after an hour


@dataclass(frozen=True)
class FitFile:
    activity_id: int
    data: bytes
    filename: str


class GarminClient:
    def __init__(
        self,
        api_key: str,
        tokens: TokenCache,
        *,
        base_url: str = BASE_URL,
        http: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        if not api_key:
            raise GarminAuthError("GARMIN_PERSONAL_API_KEY is not set")
        self._key = api_key
        self._tokens = tokens
        self._http = http or httpx.Client(timeout=60.0)
        self._base = base_url.rstrip("/")
        self._sleep = sleep
        self._now = clock

    # --- authentication ---------------------------------------------------------------------------

    def access_token(self, *, force: bool = False) -> str:
        cached = None if force else self._tokens.load()
        if cached and cached.valid(self._now()):
            return cached.value
        response = self._send("POST", TOKEN_PATH, {"Authorization": f"ApiKey {self._key}", "Accept": "*/*"})
        if response.status_code in (401, 403):
            raise GarminAuthError(f"The Personal API rejected the key (HTTP {response.status_code})")
        self._raise_for_status(response, "token")
        value = response.text.strip()
        if value.startswith("{"):  # tolerate a JSON body, in case the API ever wraps the token
            value = str(json.loads(value).get("access_token", value))
        token = AccessToken(value, token_expiry(value, self._now()))
        self._tokens.save(token)
        log.info("Garmin access token renewed", extra={"expires_at": token.expires_at.isoformat()})
        return token.value

    # --- data -------------------------------------------------------------------------------------

    def list_activities(self, since: date, until: date | None = None) -> Iterator[dict[str, Any]]:
        """Every activity started between `since` and `until` (inclusive), newest first, page by page."""
        until = until or (self._now().date() + timedelta(days=1))
        start = 0
        while True:
            params = {
                "start": start,
                "limit": PAGE_SIZE,
                "startDate": since.isoformat(),
                "endDate": until.isoformat(),
            }
            response = self._authorised("GET", LIST_PATH, {"Accept": "application/json"}, params=params)
            page = response.json()
            if isinstance(page, dict):  # tolerate a wrapped list
                page = page.get("activityList") or page.get("activities") or []
            if not isinstance(page, list):
                raise GarminError(f"Unexpected activity list: {type(page).__name__}")
            yield from page
            if len(page) < PAGE_SIZE:
                return
            start += PAGE_SIZE

    def download_fit(self, activity_id: int) -> FitFile:
        """The original FIT file of an activity, extracted from the ZIP Garmin serves."""
        headers = {"Accept": "application/zip, application/x-zip-compressed, application/octet-stream"}
        body = self._authorised("GET", DOWNLOAD_PATH.format(id=int(activity_id)), headers).content
        if body[:2] == b"PK":
            with zipfile.ZipFile(io.BytesIO(body)) as archive:
                names = [n for n in archive.namelist() if n.lower().endswith(".fit")]
                if not names:
                    raise GarminError(f"The ZIP for activity {activity_id} has no FIT file")
                return FitFile(activity_id, archive.read(names[0]), names[0])
        if body[8:12] == b".FIT":
            return FitFile(activity_id, body, f"{activity_id}.fit")
        raise GarminError(f"Unexpected download for activity {activity_id}: {body[:16]!r}")

    # --- HTTP -------------------------------------------------------------------------------------

    def _authorised(
        self, method: str, path: str, headers: dict[str, str], params: dict[str, Any] | None = None
    ) -> httpx.Response:
        response = self._send(
            method, path, {**headers, "Authorization": f"Bearer {self.access_token()}"}, params
        )
        if response.status_code == 401:  # token revoked or expired early: renew once
            token = self.access_token(force=True)
            response = self._send(method, path, {**headers, "Authorization": f"Bearer {token}"}, params)
        self._raise_for_status(response, path)
        return response

    def _send(
        self, method: str, path: str, headers: dict[str, str], params: dict[str, Any] | None = None
    ) -> httpx.Response:
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                response = self._http.request(
                    method, self._base + path, headers={"User-Agent": USER_AGENT, **headers}, params=params
                )
            except httpx.TransportError as error:
                if attempt == MAX_ATTEMPTS:
                    raise GarminError(f"{method} {path}: {error}") from error
                self._wait(attempt, None, f"network error: {error.__class__.__name__}")
                continue
            if (response.status_code == 429 or response.status_code >= 500) and attempt < MAX_ATTEMPTS:
                self._wait(attempt, response.headers.get("Retry-After"), f"HTTP {response.status_code}")
                continue
            return response
        raise AssertionError("unreachable")

    def _wait(self, attempt: int, retry_after: str | None, reason: str) -> None:
        try:
            delay = min(float(retry_after), MAX_RETRY_AFTER_S) if retry_after else 2.0**attempt
        except ValueError:
            delay = 2.0**attempt
        log.warning("Garmin request retrying", extra={"reason": reason, "attempt": attempt, "delay_s": delay})
        self._sleep(delay)

    @staticmethod
    def _raise_for_status(response: httpx.Response, what: str) -> None:
        if response.status_code >= 400:
            raise GarminError(f"{what}: HTTP {response.status_code} {response.text[:200]}")
