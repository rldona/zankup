"""The Coach (OS-705): questions in natural language, answered with the tools in `zankup.ai.tools` so
the model works from numbers it fetched, not from a history it was given. The answer is streamed as
it is written; each round of the tool loop is recorded in `llm_calls`.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Iterator
from typing import Any, Literal

import anthropic
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from zankup.ai.client import Llm, LlmBudgetExceeded, LlmError, Usage, text_of
from zankup.ai.summary import LANGUAGES
from zankup.ai.tools import ToolError, run_tool, tool_specs

log = logging.getLogger("zankup.ai")

MAX_ROUNDS = 6
MAX_MESSAGES = 40
MAX_CHARS = 4000

SYSTEM = """You are the Coach in Zankup, a personal sports data app, talking with the person whose data \
this is. Answer their questions about their training with the tools: search_activities, \
activity_details, fitness_stats, records, daily_health and estimates. Every number you state must come \
from a tool result in this conversation; if the tools do not have it, say so. Never invent an \
activity, a number, a place or a cause. When you mention an activity, give its link exactly as the \
tool returned it (like /activities/123) so the app can open it.

Be concrete and brief: a few sentences or a short list, numbers rounded sensibly, distances in km or \
miles with one decimal, paces as min/km or min/mile, times as h:mm or mm:ss. Fitness, fatigue and form \
are the app's CTL, ATL and TSB. Give training advice only when asked, from the numbers, and remind \
them you are not a doctor if they describe pain or illness. Answer in the language you are told; \
without instructions, the language of the question."""


class CoachMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=MAX_CHARS)


class CoachRequest(BaseModel):
    messages: list[CoachMessage] = Field(min_length=1, max_length=MAX_MESSAGES)


def _instructions(language: str, units: str) -> str:
    return f"(Answer in {LANGUAGES.get(language, 'English')}. Units: {units}. Today is {{today}}.)"


def answer(
    db: Session,
    llm: Llm,
    user_id: int,
    messages: list[CoachMessage],
    *,
    language: str,
    units: str,
    today: str,
) -> Iterator[dict[str, Any]]:
    """Stream the answer as events: text pieces, tool calls as they happen, then `done` (or `error`)."""
    if messages[-1].role != "user":
        yield {"type": "error", "message": "the last message must be the question"}
        return
    try:
        llm.check_budget(db, user_id)
    except LlmBudgetExceeded as error:
        yield {"type": "error", "code": "budget", "message": str(error)}
        return
    history: list[dict[str, Any]] = [{"role": m.role, "content": m.content} for m in messages]
    # The instructions ride on the question, not the system prompt, so the system prompt stays cached.
    history[-1] = {
        "role": "user",
        "content": f"{messages[-1].content}\n\n{_instructions(language, units).format(today=today)}",
    }
    total, tools_called = Usage(), []
    try:
        for _round in range(MAX_ROUNDS):
            started = time.monotonic()
            params = llm.params(
                system=SYSTEM, messages=history, tools=tool_specs(), max_tokens=4000, effort="medium"
            )
            with llm.api.messages.stream(**params) as stream:
                for event in stream:
                    if event.type == "content_block_delta" and event.delta.type == "text_delta":
                        yield {"type": "text", "text": event.delta.text}
                final = stream.get_final_message()
            usage = Usage.of(final.usage)
            total.add(usage)
            llm.record(db, user_id, "coach", usage, duration_ms=int((time.monotonic() - started) * 1000))
            db.commit()
            if final.stop_reason == "refusal":
                yield {"type": "error", "message": "the model declined to answer"}
                return
            tool_uses = [block for block in final.content if block.type == "tool_use"]
            if final.stop_reason != "tool_use" or not tool_uses:
                break
            history.append({"role": "assistant", "content": final.content})
            results = []
            for block in tool_uses:
                arguments = block.input if isinstance(block.input, dict) else {}
                yield {"type": "tool", "name": block.name, "status": "running"}
                try:
                    result = run_tool(db, user_id, block.name, arguments)
                    content, is_error = json.dumps(result, ensure_ascii=False, separators=(",", ":")), False
                    yield {"type": "tool", "name": block.name, "status": "done"}
                except ToolError as error:
                    content, is_error = f"Error: {error}", True
                    yield {"type": "tool", "name": block.name, "status": "error", "message": str(error)}
                tools_called.append(block.name)
                results.append(
                    {"type": "tool_result", "tool_use_id": block.id, "content": content, "is_error": is_error}
                )
            history.append({"role": "user", "content": results})
        else:
            yield {"type": "text", "text": "\n\n…"}
    except anthropic.RateLimitError:
        yield {"type": "error", "message": "the model is rate limited; try again in a minute"}
        return
    except anthropic.APIStatusError as error:
        yield {"type": "error", "message": f"the model answered {error.status_code}"}
        return
    except anthropic.APIConnectionError:
        yield {"type": "error", "message": "could not reach the model"}
        return
    except LlmError as error:
        yield {"type": "error", "message": str(error)}
        return
    yield {
        "type": "done",
        "tools": tools_called,
        "usage": {
            "input_tokens": total.input_tokens,
            "output_tokens": total.output_tokens,
            "cache_read_tokens": total.cache_read_tokens,
        },
    }


def answer_text(
    db: Session,
    llm: Llm,
    user_id: int,
    question: str,
    *,
    language: str = "en",
    units: str = "metric",
    today: str,
) -> tuple[str, list[str]]:
    """The whole answer and the tools used (the evaluation set and tests)."""
    text, tools = [], []
    for event in answer(
        db,
        llm,
        user_id,
        [CoachMessage(role="user", content=question)],
        language=language,
        units=units,
        today=today,
    ):
        if event["type"] == "text":
            text.append(event["text"])
        elif event["type"] == "done":
            tools = list(event["tools"])
        elif event["type"] == "error":
            raise LlmError(event["message"])
    return "".join(text), tools


def ndjson(events: Iterator[dict[str, Any]]) -> Iterator[str]:
    for event in events:
        yield json.dumps(event, ensure_ascii=False) + "\n"


def final_text(message: Any) -> str:
    return text_of(message)
