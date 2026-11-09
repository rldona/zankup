"""The AI assistant's API (phase 7): whether it is available and what it has cost (OS-701, OS-706,
OS-708), the summary of an activity (OS-703), the weekly reports (OS-704), the Coach (OS-705) and
the personal tokens of the MCP server (OS-709).

Everything here answers 409 when this instance has no Anthropic key or the user turned the
assistant off, so clients hide the features by `GET /api/ai/status` first.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from functools import lru_cache
from typing import Annotated, Any

from fastapi import Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from zankup.ai import ai_preferences
from zankup.ai.client import BUDGET_WARNING, Llm, LlmBudgetExceeded, LlmError, build_llm
from zankup.ai.coach import CoachRequest, answer, ndjson
from zankup.ai.summary import generate_summary, settings_of
from zankup.ai.weekly import generate_weekly_now, last_week_start
from zankup.api.routing import protected_router
from zankup.auth.deps import AppSettings, CurrentUser, DbSession
from zankup.auth.security import new_token, token_hash
from zankup.core.config import Settings
from zankup.db.models import Activity, ActivitySummary, ApiToken, User, WeeklyReport

router = protected_router(prefix="/api", tags=["ai"])

TOKEN_PREFIX = "zk_"


@lru_cache(maxsize=4)
def _llm(key: str, model: str, budget: float) -> Llm | None:
    settings = Settings(_env_file=None, anthropic_api_key=key, ai_model=model, ai_monthly_budget_usd=budget)
    return build_llm(settings)


def get_llm(settings: AppSettings) -> Llm | None:
    """The process's client, or None without a key. Tests override this dependency."""
    if settings.anthropic_api_key is None:
        return None
    return _llm(
        settings.anthropic_api_key.get_secret_value(), settings.ai_model, settings.ai_monthly_budget_usd
    )


MaybeLlm = Annotated[Llm | None, Depends(get_llm)]


def _require(llm: Llm | None, db: Session, user: User, feature: str | None = None) -> Llm:
    if llm is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "AI is not set up on this server")
    prefs = ai_preferences(db, user.id)
    if not prefs["enabled"] or (feature is not None and not prefs.get(feature, False)):
        raise HTTPException(status.HTTP_409_CONFLICT, "AI is turned off in Settings")
    return llm


# --- status (OS-706, OS-708) --------------------------------------------------------------------------


class AiBudget(BaseModel):
    month_cost_usd: float = Field(description="Spent this calendar month, at list prices")
    limit_usd: float
    warning: bool = Field(description="Past 80 % of the month's budget")
    exceeded: bool = Field(description="AI features pause until next month")


class AiStatus(BaseModel):
    available: bool = Field(description="This server has an Anthropic key")
    enabled: bool = Field(description="The user's global switch")
    summaries: bool
    weekly: bool
    model: str | None
    budget: AiBudget | None
    sends: list[str] = Field(description="What the model receives, for the explanation in Settings")
    never_sends: list[str]


SENDS = [
    "sport, date, duration, distance, elevation, heart rate, power and calories of an activity",
    "the metrics Zankup computes: relative effort, zones, efficiency, fitness, fatigue and form",
    "splits, laps, best efforts and records",
    "weekly totals, estimates, and sleep, HRV, resting heart rate and readiness averages",
    "your questions to the Coach and the language and units you chose",
]
NEVER_SENDS = [
    "coordinates, routes, maps or where you train",
    "activity names and descriptions, photos and device names",
    "your name, e-mail, birth date, sex, weight or height",
]


@router.get("/ai/status", operation_id="getAiStatus")
def ai_status(db: DbSession, user: CurrentUser, llm: MaybeLlm) -> AiStatus:
    prefs = ai_preferences(db, user.id)
    budget = None
    if llm is not None:
        spent = llm.month_cost(db, user.id)
        budget = AiBudget(
            month_cost_usd=round(spent, 4),
            limit_usd=llm.budget_usd,
            warning=spent >= llm.budget_usd * BUDGET_WARNING,
            exceeded=spent >= llm.budget_usd,
        )
    return AiStatus(
        available=llm is not None,
        enabled=prefs["enabled"],
        summaries=prefs["summaries"],
        weekly=prefs["weekly"],
        model=llm.model if llm else None,
        budget=budget,
        sends=SENDS,
        never_sends=NEVER_SENDS,
    )


# --- activity summary (OS-703) ------------------------------------------------------------------------


class SummaryOut(BaseModel):
    activity_id: int
    language: str
    suggested_title: str
    summary: str
    highlights: list[str]
    model: str
    created_at: datetime


def _summary_out(row: ActivitySummary) -> SummaryOut:
    return SummaryOut(
        activity_id=row.activity_id,
        language=row.language,
        suggested_title=row.suggested_title,
        summary=row.summary,
        highlights=list(row.highlights or []),
        model=row.model,
        created_at=row.created_at,
    )


def _own_activity(db: Session, user: User, activity_id: int) -> Activity:
    activity = db.get(Activity, activity_id)
    if activity is None or activity.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activity not found")
    return activity


@router.get("/activities/{activity_id}/summary", operation_id="getActivitySummary")
def get_summary(activity_id: int, db: DbSession, user: CurrentUser) -> SummaryOut:
    _own_activity(db, user, activity_id)
    row = db.get(ActivitySummary, activity_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No summary yet")
    return _summary_out(row)


@router.post("/activities/{activity_id}/summary", operation_id="createActivitySummary")
def create_summary(activity_id: int, db: DbSession, user: CurrentUser, llm: MaybeLlm) -> SummaryOut:
    """Write (or rewrite) the summary now."""
    activity = _own_activity(db, user, activity_id)
    client = _require(llm, db, user, "summaries")
    try:
        row = generate_summary(db, client, activity)
    except LlmBudgetExceeded as error:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Monthly AI budget reached: {error}") from error
    except LlmError as error:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(error)) from error
    db.commit()
    return _summary_out(row)


# --- weekly report (OS-704) ---------------------------------------------------------------------------


class WeeklyOut(BaseModel):
    id: int
    week_start: date
    status: str = Field(description="pending, done or failed")
    language: str
    headline: str | None
    summary: str | None
    recommendation: str | None
    highlights: list[str] | None
    error: str | None
    created_at: datetime
    finished_at: datetime | None


def _weekly_out(row: WeeklyReport) -> WeeklyOut:
    return WeeklyOut(
        id=row.id,
        week_start=row.week_start,
        status=row.status,
        language=row.language,
        headline=row.headline,
        summary=row.summary,
        recommendation=row.recommendation,
        highlights=list(row.highlights) if row.highlights is not None else None,
        error=row.error,
        created_at=row.created_at,
        finished_at=row.finished_at,
    )


@router.get("/ai/weekly", operation_id="listWeeklyReports")
def list_weekly(db: DbSession, user: CurrentUser) -> list[WeeklyOut]:
    """The latest reports, newest first."""
    rows = db.scalars(
        select(WeeklyReport)
        .where(WeeklyReport.user_id == user.id)
        .order_by(WeeklyReport.week_start.desc())
        .limit(12)
    )
    return [_weekly_out(r) for r in rows]


class WeeklyRequest(BaseModel):
    week_start: date | None = Field(None, description="A Monday; by default the week that just ended")


@router.post("/ai/weekly", operation_id="createWeeklyReport")
def create_weekly(body: WeeklyRequest, db: DbSession, user: CurrentUser, llm: MaybeLlm) -> WeeklyOut:
    """Write last week's report now, without waiting for Monday's batch."""
    client = _require(llm, db, user, "weekly")
    week_start = body.week_start or last_week_start(datetime.now(UTC).date())
    if week_start.weekday() != 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "week_start must be a Monday")
    if week_start > datetime.now(UTC).date():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "that week has not started")
    try:
        row = generate_weekly_now(db, client, user.id, week_start)
    except LlmBudgetExceeded as error:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Monthly AI budget reached: {error}") from error
    except LlmError as error:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(error)) from error
    db.commit()
    return _weekly_out(row)


# --- Coach (OS-705) -----------------------------------------------------------------------------------


@router.post(
    "/ai/coach",
    operation_id="askCoach",
    response_class=StreamingResponse,
    responses={200: {"content": {"application/x-ndjson": {}}, "description": "One JSON event per line"}},
)
def ask_coach(body: CoachRequest, db: DbSession, user: CurrentUser, llm: MaybeLlm) -> StreamingResponse:
    """Ask the Coach. The answer streams as NDJSON events: `text` pieces, `tool` calls, then `done`
    (or `error`)."""
    client = _require(llm, db, user)
    language, units = settings_of(db, user.id)
    events = answer(
        db,
        client,
        user.id,
        body.messages,
        language=language,
        units=units,
        today=datetime.now(UTC).date().isoformat(),
    )
    return StreamingResponse(ndjson(events), media_type="application/x-ndjson")


# --- MCP tokens (OS-709) ------------------------------------------------------------------------------


class ApiTokenOut(BaseModel):
    id: int
    name: str
    prefix: str = Field(description="The first characters, to tell tokens apart")
    created_at: datetime
    last_used_at: datetime | None


class ApiTokenCreated(ApiTokenOut):
    token: str = Field(description="Shown once: it is not stored")
    url: str = Field(description="The MCP server's URL")


class ApiTokenRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


def _token_out(row: ApiToken) -> dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "prefix": row.prefix,
        "created_at": row.created_at,
        "last_used_at": row.last_used_at,
    }


@router.get("/ai/tokens", operation_id="listApiTokens")
def list_tokens(db: DbSession, user: CurrentUser) -> list[ApiTokenOut]:
    rows = db.scalars(
        select(ApiToken)
        .where(ApiToken.user_id == user.id, ApiToken.revoked_at.is_(None))
        .order_by(ApiToken.created_at.desc())
    )
    return [ApiTokenOut(**_token_out(r)) for r in rows]


@router.post("/ai/tokens", operation_id="createApiToken", status_code=status.HTTP_201_CREATED)
def create_token(
    body: ApiTokenRequest, db: DbSession, user: CurrentUser, settings: AppSettings
) -> ApiTokenCreated:
    """A new personal token for the MCP server; the token itself is returned only here."""
    secret, _ = new_token()
    token = TOKEN_PREFIX + secret
    row = ApiToken(user_id=user.id, name=body.name.strip(), token_hash=token_hash(token), prefix=token[:8])
    db.add(row)
    db.commit()
    return ApiTokenCreated(**_token_out(row), token=token, url=f"{settings.api_public_url or ''}/api/mcp")


@router.delete("/ai/tokens/{token_id}", operation_id="revokeApiToken", status_code=status.HTTP_204_NO_CONTENT)
def revoke_token(token_id: int, db: DbSession, user: CurrentUser) -> None:
    row = db.get(ApiToken, token_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Token not found")
    if row.revoked_at is None:
        row.revoked_at = datetime.now(UTC)
        db.commit()
