"""Sync failure alerts: one e-mail at the third failure in a row, one when it works again."""

import json
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
import respx
from pydantic import SecretStr
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from tests.test_sync import garmin_api  # noqa: F401 - fixture serving the scrubbed Garmin page and FITs
from zankup.alerts import RESEND_URL, email_sender, notify_sync_outcome, sync_alert
from zankup.core.config import Settings
from zankup.db.models import SyncRun, User
from zankup.storage import LocalRawStore
from zankup.sync.garmin import BASE_URL, LIST_PATH, GarminClient, MemoryTokenCache
from zankup.sync.orchestrator import run_sync


@pytest.fixture
def sessions(database: str) -> Iterator[sessionmaker[Session]]:
    engine = create_engine(database)
    yield sessionmaker(engine, expire_on_commit=False)
    engine.dispose()


@pytest.fixture
def user_id(sessions: sessionmaker[Session]) -> int:
    with sessions.begin() as db:
        user = User(email="runner@example.com")
        db.add(user)
        db.flush()
        return user.id


def finish(sessions: sessionmaker[Session], user_id: int, status: str, minute: int) -> tuple[str, str] | None:
    """Record a finished run and return the alert it calls for."""
    when = datetime(2026, 11, 1, tzinfo=UTC) + timedelta(minutes=minute)
    with sessions.begin() as db:
        db.add(
            SyncRun(
                user_id=user_id,
                trigger="cron",
                status=status,
                started_at=when,
                finished_at=when,
                error="HTTP 401" if status == "error" else None,
            )
        )
    with sessions() as db:
        return sync_alert(db, user_id)


def test_one_alert_per_streak_and_one_when_it_recovers(sessions: sessionmaker[Session], user_id: int) -> None:
    outcomes = [
        finish(sessions, user_id, status, minute)
        for minute, status in enumerate(
            ["success", "error", "error", "error", "error", "error", "success", "success"]
        )
    ]
    subjects = [alert[0] if alert else None for alert in outcomes]
    assert subjects[:3] == [None, None, None]
    assert subjects[3] is not None and "3 times in a row" in subjects[3]
    assert outcomes[3] is not None and "HTTP 401" in outcomes[3][1]
    assert subjects[4:6] == [None, None]  # the streak goes on: no more e-mails
    assert subjects[6] is not None and "works again" in subjects[6]
    assert outcomes[6] is not None and "5 failed attempts" in outcomes[6][1]
    assert subjects[7] is None


def test_two_failures_then_success_sends_nothing(sessions: sessionmaker[Session], user_id: int) -> None:
    assert [finish(sessions, user_id, s, m) for m, s in enumerate(["error", "error", "success"])] == [
        None
    ] * 3


def test_the_third_failed_sync_sends_the_email(
    sessions: sessionmaker[Session],
    user_id: int,
    garmin_api: respx.Router,  # noqa: F811
    tmp_path: Path,
) -> None:
    garmin_api.get(BASE_URL + LIST_PATH).mock(return_value=httpx.Response(400, text="bad request"))
    sent: list[tuple[str, str]] = []
    garmin = GarminClient("key", MemoryTokenCache(), http=httpx.Client())
    for _ in range(4):
        with pytest.raises(Exception, match="HTTP 400"):
            run_sync(
                sessions,
                LocalRawStore(tmp_path),
                garmin,
                user_id=user_id,
                sleep=lambda _: None,
                alert=lambda subject, text: sent.append((subject, text)),
            )
    assert len(sent) == 1 and "HTTP 400" in sent[0][1]


def test_a_failing_sender_never_breaks_the_sync(sessions: sessionmaker[Session], user_id: int) -> None:
    for minute in range(3):
        finish(sessions, user_id, "error", minute)

    def broken(_: str, __: str) -> None:
        raise httpx.ConnectError("no network")

    with sessions() as db:
        notify_sync_outcome(db, user_id, broken)  # logged, not raised


def test_resend_request() -> None:
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None, resend_api_key=SecretStr("re_test"), alert_email="me@example.com"
    )
    send = email_sender(settings)
    assert send is not None
    with respx.mock() as router:
        route = router.post(RESEND_URL).respond(200, json={"id": "1"})
        send("Subject", "Body")
    request = route.calls[0].request
    assert request.headers["Authorization"] == "Bearer re_test"
    assert json.loads(request.content) == {
        "from": "Zankup <onboarding@resend.dev>",
        "to": ["me@example.com"],
        "subject": "Subject",
        "text": "Body",
    }
    assert email_sender(Settings(_env_file=None, resend_api_key=SecretStr("re_test"))) is None  # type: ignore[call-arg]
