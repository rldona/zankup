"""The automatic summary of each activity (OS-703): two or three sentences in the user's language on
what it was, how it compared with the usual and any record, with a suggested title, generated when
the engine has computed the activity's metrics. Only recent activities are summarised on import; an
older one is summarised when the user asks from its page.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from zankup.ai import ai_wants
from zankup.ai.client import Llm
from zankup.ai.context import activity_context
from zankup.db.models import Activity, ActivitySummary, Job, UserSettings
from zankup.engine import METRICS_VERSION
from zankup.jobs.queue import enqueue

log = logging.getLogger("zankup.ai")

RECENT = timedelta(days=14)  # a history backfill is not summarised on import (it would cost money)
LANGUAGES = {"en": "English", "es": "Spanish"}

SYSTEM = """You write the short summary shown at the top of an activity in Zankup, a personal sports \
data app. You receive one activity as JSON: its numbers, the metrics the app computed (relative effort, \
heart-rate zones, efficiency), its splits or laps, the records it set, the person's form that day and \
the medians of their previous 90 days in the same sport ("usual").

Write for the person who did the activity, in the language and units you are told. Two or three plain \
sentences: what it was (sport, distance or duration, intensity), how it compared with their usual, and \
anything notable (a record, a negative split, unusual heart rate, a hard day on low form). Use only \
the numbers you are given, rounded sensibly; never invent a number, a place or a cause. No greetings, \
no emoji, no advice beyond one short observation. Distances in km or miles with one decimal, paces as \
min/km or min/mile, times as h:mm or mm:ss.

Every comparison comes from "comparisons": say its baseline and its direction exactly as given, \
never the opposite; if two baselines disagree on a measure, say both in one sentence, naming each. \
Also propose a short title (at most 50 characters) that describes the session, like "Easy 10 km with \
negative splits", never a place, and up to three highlights of a few words each."""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "suggested_title": {"type": "string"},
        "summary": {"type": "string"},
        "highlights": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["suggested_title", "summary", "highlights"],
    "additionalProperties": False,
}


def settings_of(db: Session, user_id: int) -> tuple[str, str]:
    """The user's language and units, with defaults."""
    row = db.scalar(select(UserSettings).where(UserSettings.user_id == user_id))
    language = row.language if row is not None and row.language in LANGUAGES else "en"
    units = row.units if row is not None and row.units in ("metric", "imperial") else "metric"
    return language, units


def user_message(context: dict[str, Any], *, language: str, units: str) -> str:
    return (
        f"Language: {LANGUAGES.get(language, 'English')}. Units: {units}.\n"
        f"Activity:\n{json.dumps(context, ensure_ascii=False, separators=(',', ':'))}"
    )


def maybe_queue_summary(db: Session, activity: Activity) -> bool:
    """After the engine computed an activity: queue its summary if AI is on and the activity is recent."""
    from zankup.core.config import get_settings
    from zankup.instance_keys import effective

    if not effective(get_settings(), db).integrations()["ai"]:
        return False
    if not ai_wants(db, activity.user_id, "summaries"):
        return False
    if datetime.now(UTC) - activity.start_utc > RECENT:
        return False
    return (
        enqueue(
            db,
            "ai_summary",
            user_id=activity.user_id,
            payload={"activity_id": activity.id},
            dedupe_key=f"summary:{activity.id}:{METRICS_VERSION}",
            max_attempts=3,
        )
        is not None
    )


def generate_summary(db: Session, llm: Llm, activity: Activity) -> ActivitySummary:
    """Ask the model and keep (or replace) the activity's summary."""
    language, units = settings_of(db, activity.user_id)
    context = activity_context(db, activity)
    # The same comparisons as the report's (ai/report.py), so the two never say opposite things.
    from zankup.ai.report import _route, comparisons

    context["comparisons"] = comparisons(context, _route(db, activity))
    completion = llm.complete(
        db,
        activity.user_id,
        "summary",
        system=SYSTEM,
        messages=[{"role": "user", "content": user_message(context, language=language, units=units)}],
        output_schema=SCHEMA,
        max_tokens=1500,
        effort="low",
    )
    data = completion.json()
    row = db.get(ActivitySummary, activity.id)
    if row is None:
        row = ActivitySummary(activity_id=activity.id, user_id=activity.user_id)
        db.add(row)
    row.language = language
    row.suggested_title = str(data.get("suggested_title") or "")[:120]
    row.summary = str(data.get("summary") or "").strip()
    row.highlights = [str(h)[:120] for h in (data.get("highlights") or []) if str(h).strip()][:4]
    row.model = llm.model
    row.metrics_version = METRICS_VERSION
    row.created_at = datetime.now(UTC)
    db.flush()
    return row


def summary_handler(llm: Llm):  # type: ignore[no-untyped-def]
    """The `ai_summary` job. Payload: activity_id."""

    def handle(session: Session, job: Job) -> None:
        activity = session.get(Activity, int(job.payload["activity_id"]))
        if activity is None or activity.user_id != job.user_id:
            return
        if not ai_wants(session, job.user_id, "summaries"):
            return
        generate_summary(session, llm, activity)

    return handle
