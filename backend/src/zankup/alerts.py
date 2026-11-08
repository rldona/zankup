"""E-mail alerts to the owner (OS-114), sent with Resend.

One alert when the Garmin sync fails three times in a row, and one when it works again after that. A
streak sends a single alert however long it lasts, so a Garmin outage over a weekend is one e-mail, not
one every 15 minutes. Without RESEND_API_KEY or ALERT_EMAIL alerts are only logged.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from zankup.core.config import Settings
from zankup.db.models import SyncRun

log = logging.getLogger("zankup.alerts")

RESEND_URL = "https://api.resend.com/emails"
FAILURES_BEFORE_ALERT = 3

Sender = Callable[[str, str], None]  # (subject, text)


@dataclass(frozen=True)
class Email:
    api_key: str
    sender: str
    to: str

    def send(self, subject: str, text: str) -> None:
        response = httpx.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={"from": self.sender, "to": [self.to], "subject": subject, "text": text},
            timeout=10,
        )
        response.raise_for_status()


def send_email(settings: Settings, to: str, subject: str, text: str) -> bool:
    """One e-mail to any address of the instance's user (password recovery). False when e-mail is not
    configured or Resend refuses it; the caller decides whether that matters."""
    if settings.resend_api_key is None:
        log.warning("E-mail not sent: RESEND_API_KEY is not set", extra={"subject": subject})
        return False
    try:
        Email(settings.resend_api_key.get_secret_value(), settings.alert_from, to).send(subject, text)
    except httpx.HTTPError as error:
        log.warning("E-mail not sent", extra={"subject": subject, "error": str(error)[:200]})
        return False
    return True


def email_sender(settings: Settings) -> Sender | None:
    if settings.resend_api_key is None or not settings.alert_email:
        return None
    return Email(settings.resend_api_key.get_secret_value(), settings.alert_from, settings.alert_email).send


def _finished(session: Session, user_id: int, limit: int) -> list[SyncRun]:
    return list(
        session.scalars(
            select(SyncRun)
            .where(SyncRun.user_id == user_id, SyncRun.status.in_(("success", "error")))
            .order_by(SyncRun.finished_at.desc(), SyncRun.id.desc())
            .limit(limit)
        )
    )


def sync_alert(session: Session, user_id: int) -> tuple[str, str] | None:
    """The alert the latest finished run calls for, if any: (subject, text)."""
    runs = _finished(session, user_id, FAILURES_BEFORE_ALERT + 1)
    if not runs:
        return None
    streak = 0
    for run in runs:
        if run.status != "error":
            break
        streak += 1
    if streak == FAILURES_BEFORE_ALERT:  # exactly at the third failure: once per streak
        latest = runs[0]
        return (
            f"Zankup: the Garmin sync has failed {FAILURES_BEFORE_ALERT} times in a row",
            "The last three Garmin syncs failed. New activities are not arriving.\n\n"
            f"Latest error ({latest.finished_at:%Y-%m-%d %H:%M} UTC):\n{latest.error or 'unknown'}\n\n"
            "Zankup keeps trying on schedule and will e-mail you when it works again. If the error "
            "mentions the API key, create a new one in Garmin Connect and update GARMIN_PERSONAL_API_KEY.",
        )
    if runs[0].status == "success" and len(runs) > 1:
        failed_before = _failed_streak_before(session, user_id, runs[0])
        if failed_before >= FAILURES_BEFORE_ALERT:
            return (
                "Zankup: the Garmin sync works again",
                f"The Garmin sync worked again after {failed_before} failed attempts. "
                f"{runs[0].new_count} new activities were found.",
            )
    return None


def _failed_streak_before(session: Session, user_id: int, success: SyncRun) -> int:
    earlier = session.scalars(
        select(SyncRun.status)
        .where(
            SyncRun.user_id == user_id,
            SyncRun.status.in_(("success", "error")),
            SyncRun.id != success.id,
            SyncRun.finished_at <= success.finished_at,
        )
        .order_by(SyncRun.finished_at.desc(), SyncRun.id.desc())
        .limit(1000)
    )
    streak = 0
    for status in earlier:
        if status != "error":
            break
        streak += 1
    return streak


def notify_sync_outcome(session: Session, user_id: int, send: Sender | None) -> None:
    """Send the alert the latest run calls for. Never raises: an alert must not break a sync."""
    try:
        alert = sync_alert(session, user_id)
        if alert is None:
            return
        log.warning("Sync alert", extra={"subject": alert[0]})
        if send is not None:
            send(*alert)
    except Exception:
        log.exception("Could not send the sync alert")
