"""Monday's report on the week that ended (OS-704): volume, load, fitness and form, sleep and one
recommendation, in the user's language. It is not urgent, so it goes through the Batch API at half
price: the `ai_weekly` job submits the request and `ai_weekly_poll` collects the answer, stores it and
sends the notification. The report can also be generated on demand from the Coach page.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from zankup.ai import ai_wants
from zankup.ai.client import Llm, LlmError, Usage, text_of
from zankup.ai.context import weekly_context
from zankup.ai.summary import LANGUAGES, settings_of
from zankup.db.models import Job, WeeklyReport
from zankup.jobs.queue import enqueue

log = logging.getLogger("zankup.ai")

POLL_EVERY = timedelta(minutes=10)
GIVE_UP_AFTER = timedelta(hours=26)  # batches finish within 24 hours

SYSTEM = """You write the weekly training report in Zankup, a personal sports data app. You receive one \
week as JSON: totals by sport, the activities, the previous weeks, the daily training load with fitness \
(CTL), fatigue (ATL) and form (TSB), the records set, the current estimates and the week's sleep and \
recovery averages when there are any.

Write for the person who trained, in the language and units you are told, in a warm but plain voice. \
A headline of a few words, a summary of three to five sentences (volume against the previous weeks, \
how the load moved fitness and form, records, sleep and recovery if present), one recommendation for \
the coming week that follows from the numbers (recover, keep, build), and up to four highlights of a \
few words each. Use only the numbers you are given, rounded sensibly; never invent a number, a place, \
an injury or a cause. No greetings and no emoji. Distances in km or miles with one decimal, times as \
h:mm."""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "headline": {"type": "string", "maxLength": 160},
        "summary": {"type": "string"},
        "recommendation": {"type": "string"},
        "highlights": {"type": "array", "items": {"type": "string"}, "maxItems": 4},
    },
    "required": ["headline", "summary", "recommendation", "highlights"],
    "additionalProperties": False,
}


def last_week_start(today: date) -> date:
    """The Monday of the week before the one `today` is in."""
    return today - timedelta(days=today.weekday() + 7)


def user_message(context: dict[str, Any], *, language: str, units: str) -> str:
    return (
        f"Language: {LANGUAGES.get(language, 'English')}. Units: {units}.\n"
        f"Week:\n{json.dumps(context, ensure_ascii=False, separators=(',', ':'))}"
    )


def queue_weekly(session: Session, user_id: int, when: datetime, hour: int) -> int | None:
    """Called by the scheduler on every tick: on a Monday, queue last week's report, due at `hour`
    UTC; one per week (the week is in the dedupe key)."""
    if when.weekday() != 0 or not ai_wants(session, user_id, "weekly"):
        return None
    week_start = last_week_start(when.date())
    if session.scalar(
        select(WeeklyReport.id).where(WeeklyReport.user_id == user_id, WeeklyReport.week_start == week_start)
    ):
        return None
    due = when.replace(hour=hour, minute=0, second=0, microsecond=0)
    return enqueue(
        session,
        "ai_weekly",
        user_id=user_id,
        payload={"week_start": week_start.isoformat()},
        run_after=max(due, when),
        dedupe_key=f"weekly:{user_id}:{week_start.isoformat()}",
        max_attempts=3,
    )


def _report(session: Session, user_id: int, week_start: date) -> WeeklyReport:
    row = session.scalar(
        select(WeeklyReport).where(WeeklyReport.user_id == user_id, WeeklyReport.week_start == week_start)
    )
    if row is None:
        row = WeeklyReport(user_id=user_id, week_start=week_start, language="en", status="pending")
        session.add(row)
        session.flush()
    return row


def _store(session: Session, report: WeeklyReport, data: dict[str, Any]) -> None:
    report.headline = str(data.get("headline") or "")[:160]
    report.summary = str(data.get("summary") or "").strip()
    report.recommendation = str(data.get("recommendation") or "").strip()
    report.highlights = [str(h)[:120] for h in (data.get("highlights") or []) if str(h).strip()][:4]
    report.status, report.error, report.finished_at = "done", None, datetime.now(UTC)
    from zankup.notify import notify

    notify(
        session,
        report.user_id,
        "weekly",
        {"week_start": report.week_start.isoformat(), "headline": report.headline},
        key=f"weekly:{report.user_id}:{report.week_start.isoformat()}",
    )


def generate_weekly_now(session: Session, llm: Llm, user_id: int, week_start: date) -> WeeklyReport:
    """The report at once, through a normal request (the Coach page's button)."""
    language, units = settings_of(session, user_id)
    context = weekly_context(session, user_id, week_start)
    report = _report(session, user_id, week_start)
    report.language, report.context = language, context
    completion = llm.complete(
        session,
        user_id,
        "weekly",
        system=SYSTEM,
        messages=[{"role": "user", "content": user_message(context, language=language, units=units)}],
        output_schema=SCHEMA,
        max_tokens=2500,
        effort="low",
    )
    _store(session, report, completion.json())
    return report


def weekly_handler(llm: Llm):  # type: ignore[no-untyped-def]
    """The `ai_weekly` job: submit the week to the Batch API and queue the first poll."""

    def handle(session: Session, job: Job) -> None:
        week_start = date.fromisoformat(str(job.payload["week_start"]))
        if not ai_wants(session, job.user_id, "weekly"):
            return
        llm.check_budget(session, job.user_id)
        language, units = settings_of(session, job.user_id)
        context = weekly_context(session, job.user_id, week_start)
        report = _report(session, job.user_id, week_start)
        report.language, report.context = language, context
        if report.status == "done":
            return
        params = llm.params(
            system=SYSTEM,
            messages=[{"role": "user", "content": user_message(context, language=language, units=units)}],
            output_schema=SCHEMA,
            max_tokens=2500,
            effort="low",
        )
        batch = llm.api.messages.batches.create(
            requests=[{"custom_id": f"weekly-{report.id}", "params": params}]
        )
        report.batch_id, report.status = batch.id, "pending"
        enqueue(
            session,
            "ai_weekly_poll",
            user_id=job.user_id,
            payload={"report_id": report.id},
            run_after=datetime.now(UTC) + POLL_EVERY,
            dedupe_key=f"weekly_poll:{report.id}:0",
            max_attempts=3,
        )
        log.info("Weekly report submitted", extra={"report_id": report.id, "batch_id": batch.id})

    return handle


def weekly_poll_handler(llm: Llm):  # type: ignore[no-untyped-def]
    """The `ai_weekly_poll` job: when the batch has ended, store the report and notify; otherwise
    come back later. Payload: report_id, attempt."""

    def handle(session: Session, job: Job) -> None:
        report = session.get(WeeklyReport, int(job.payload["report_id"]))
        if report is None or report.status != "pending" or not report.batch_id:
            return
        attempt = int(job.payload.get("attempt", 0))
        batch = llm.api.messages.batches.retrieve(report.batch_id)
        if batch.processing_status != "ended":
            if datetime.now(UTC) - report.created_at > GIVE_UP_AFTER:
                report.status, report.error = "failed", "the batch did not finish in time"
                report.finished_at = datetime.now(UTC)
                return
            enqueue(
                session,
                "ai_weekly_poll",
                user_id=job.user_id,
                payload={"report_id": report.id, "attempt": attempt + 1},
                run_after=datetime.now(UTC) + POLL_EVERY,
                dedupe_key=f"weekly_poll:{report.id}:{attempt + 1}",
                max_attempts=3,
            )
            return
        for result in llm.api.messages.batches.results(report.batch_id):
            if result.custom_id != f"weekly-{report.id}":
                continue
            if result.result.type == "succeeded":
                message = result.result.message
                llm.record(
                    session, job.user_id, "weekly", Usage.of(message.usage), batch=True, model=message.model
                )
                try:
                    data = json.loads(text_of(message))
                    if not isinstance(data, dict):
                        raise LlmError("not a JSON object")
                except (json.JSONDecodeError, LlmError) as error:
                    report.status, report.error = "failed", f"the model did not answer with JSON: {error}"
                    report.finished_at = datetime.now(UTC)
                    return
                _store(session, report, data)
            else:
                report.status, report.error = "failed", f"batch result {result.result.type}"
                report.finished_at = datetime.now(UTC)
            return
        report.status, report.error, report.finished_at = (
            "failed",
            "no result in the batch",
            datetime.now(UTC),
        )

    return handle
