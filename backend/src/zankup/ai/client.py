"""The model behind the assistant (OS-701) and what it costs (OS-706).

One `Llm` per process wraps the official SDK client: it sends requests with a stable, cached system
prompt, turns the SDK's errors into `LlmError`, writes every call to `llm_calls` with its tokens and
cost, and refuses to spend past the monthly budget. Tests build it with a fake client.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import anthropic
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from zankup.core.config import Settings
from zankup.db.models import LlmCall

log = logging.getLogger("zankup.ai")

# USD per million tokens (input, output) at list price, for prompts up to 100K tokens. Cache reads cost
# a tenth of the input price and cache writes a quarter more; the Batch API halves everything.
PRICES: dict[str, tuple[float, float]] = {
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-opus-5-5": (4.00, 20.00),
}
BUDGET_WARNING = 0.8  # of the monthly budget


class LlmError(Exception):
    """The model could not answer."""


class LlmUnavailable(LlmError):
    """This instance has no Anthropic key, or the user turned the assistant off."""


class LlmBudgetExceeded(LlmError):
    """This month's spending cap is reached; AI features pause until next month."""


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0

    @classmethod
    def of(cls, usage: Any) -> Usage:
        """From the SDK's usage object (any of its fields may be missing or null)."""

        def field(name: str) -> int:
            return int(getattr(usage, name, 0) or 0) if usage is not None else 0

        return cls(
            input_tokens=field("input_tokens"),
            output_tokens=field("output_tokens"),
            cache_read_tokens=field("cache_read_input_tokens"),
            cache_write_tokens=field("cache_creation_input_tokens"),
        )

    def add(self, other: Usage) -> None:
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.cache_read_tokens += other.cache_read_tokens
        self.cache_write_tokens += other.cache_write_tokens


def cost_usd(model: str, usage: Usage, *, batch: bool = False) -> float:
    """What a call costs at list price. An unknown model is priced as the dearest known one."""
    price_in, price_out = PRICES.get(model, max(PRICES.values()))
    cost = (
        usage.input_tokens * price_in
        + usage.cache_read_tokens * price_in * 0.1
        + usage.cache_write_tokens * price_in * 1.25
        + usage.output_tokens * price_out
    ) / 1_000_000
    return round(cost / 2 if batch else cost, 8)


@dataclass
class Completion:
    text: str
    usage: Usage
    stop_reason: str | None
    cost_usd: float

    def json(self) -> dict[str, Any]:
        try:
            data = json.loads(self.text)
        except json.JSONDecodeError as error:
            raise LlmError(f"the model did not answer with JSON: {error}") from error
        if not isinstance(data, dict):
            raise LlmError("the model did not answer with a JSON object")
        return data


def system_blocks(text: str) -> list[dict[str, Any]]:
    """A system prompt marked for the prompt cache: it is the same on every call of its kind (OS-706)."""
    return [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]


def text_of(message: Any) -> str:
    return "".join(block.text for block in message.content if getattr(block, "type", None) == "text")


class Llm:
    def __init__(self, api: Any, model: str, *, budget_usd: float) -> None:
        self.api, self.model, self.budget_usd = api, model, budget_usd

    # --- budget (OS-706) -----------------------------------------------------------------------------

    def month_cost(self, db: Session, user_id: int) -> float:
        start = datetime.now(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        total = db.scalar(
            select(func.coalesce(func.sum(LlmCall.cost_usd), 0.0)).where(
                LlmCall.user_id == user_id, LlmCall.created_at >= start
            )
        )
        return float(total or 0)

    def check_budget(self, db: Session, user_id: int) -> None:
        spent = self.month_cost(db, user_id)
        if spent >= self.budget_usd:
            raise LlmBudgetExceeded(f"{spent:.2f} USD spent this month of a {self.budget_usd:.2f} USD budget")

    def record(
        self,
        db: Session,
        user_id: int,
        purpose: str,
        usage: Usage,
        *,
        duration_ms: int | None = None,
        batch: bool = False,
        model: str | None = None,
    ) -> LlmCall:
        model = model or self.model
        call = LlmCall(
            user_id=user_id,
            purpose=purpose,
            model=model,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cache_read_tokens=usage.cache_read_tokens,
            cache_write_tokens=usage.cache_write_tokens,
            cost_usd=cost_usd(model, usage, batch=batch),
            batch=batch,
            duration_ms=duration_ms,
        )
        db.add(call)
        db.flush()
        log.info(
            "LLM call",
            extra={
                "purpose": purpose,
                "model": model,
                "input_tokens": usage.input_tokens,
                "output_tokens": usage.output_tokens,
                "cache_read_tokens": usage.cache_read_tokens,
                "cost_usd": call.cost_usd,
                "batch": batch,
            },
        )
        return call

    # --- requests ------------------------------------------------------------------------------------

    def params(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        output_schema: dict[str, Any] | None = None,
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 2048,
        effort: str = "low",
    ) -> dict[str, Any]:
        """The request, shared by direct calls and Batch API requests."""
        output_config: dict[str, Any] = {"effort": effort}
        if output_schema is not None:
            output_config["format"] = {"type": "json_schema", "schema": output_schema}
        params: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "system": system_blocks(system),
            "messages": messages,
            "output_config": output_config,
        }
        if tools:
            params["tools"] = tools
        return params

    def complete(
        self,
        db: Session,
        user_id: int,
        purpose: str,
        *,
        system: str,
        messages: list[dict[str, Any]],
        output_schema: dict[str, Any] | None = None,
        max_tokens: int = 2048,
        effort: str = "low",
    ) -> Completion:
        """One request without tools, recorded in `llm_calls`."""
        self.check_budget(db, user_id)
        started = time.monotonic()
        try:
            response = self.api.messages.create(
                **self.params(
                    system=system,
                    messages=messages,
                    output_schema=output_schema,
                    max_tokens=max_tokens,
                    effort=effort,
                )
            )
        except anthropic.RateLimitError as error:
            raise LlmError("the model is rate limited; try again later") from error
        except anthropic.APIStatusError as error:
            raise LlmError(f"the model answered {error.status_code}") from error
        except anthropic.APIConnectionError as error:
            raise LlmError("could not reach the model") from error
        usage = Usage.of(response.usage)
        call = self.record(db, user_id, purpose, usage, duration_ms=int((time.monotonic() - started) * 1000))
        if response.stop_reason == "refusal":
            raise LlmError("the model declined to answer")
        if response.stop_reason == "max_tokens":
            raise LlmError("the answer was cut short")
        return Completion(text_of(response), usage, response.stop_reason, call.cost_usd)


def build_llm(settings: Settings) -> Llm | None:
    """The process's client, or None when this instance has no key (every AI feature stays hidden)."""
    if settings.anthropic_api_key is None:
        return None
    api = anthropic.Anthropic(
        api_key=settings.anthropic_api_key.get_secret_value(), max_retries=2, timeout=90.0
    )
    return Llm(api, settings.ai_model, budget_usd=settings.ai_monthly_budget_usd)
