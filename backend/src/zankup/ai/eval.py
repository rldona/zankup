"""The quality evaluation (OS-707): real activities and questions, in both languages, run against a
database with the real model, checking that every number the model quotes exists in the data it was
given. Run it before changing a prompt or the model:

    uv run python -m zankup.ai.eval                      # fixtures/ai_eval/cases.json, both languages
    uv run python -m zankup.ai.eval --language es --only coach

It needs DATABASE_URL (with activities) and ANTHROPIC_API_KEY, and it spends money: about 40 calls on
the small model, a few cents. Calls are recorded in `llm_calls` with purpose `eval`.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from zankup.ai.client import Llm, LlmError, build_llm
from zankup.ai.coach import answer_text
from zankup.ai.context import activity_context
from zankup.ai.summary import SCHEMA, SYSTEM, user_message
from zankup.db.models import Activity, User

CASES = Path(__file__).resolve().parents[4] / "fixtures" / "ai_eval" / "cases.json"
NUMBER = re.compile(r"(?<![\w/.])(\d+(?:[.,]\d+)?)(?![\w/])")  # not inside words or links
# Small integers (list counts, "one of three", zone numbers) are not worth flagging.
IGNORED_BELOW = 10


@dataclass
class Case:
    id: str
    kind: str  # summary or coach
    language: str
    question: str | None = None
    activity: str = "latest"  # latest, latest:<sport> or an id
    expect_tools: list[str] = field(default_factory=list)
    expect_any: list[str] = field(default_factory=list)  # one of these words must be in the answer


@dataclass
class Outcome:
    case: Case
    ok: bool
    answer: str
    problems: list[str]
    tools: list[str] = field(default_factory=list)


def numbers_in(text: str) -> list[float]:
    """Every number quoted in a text, as floats (1.234,5 and 1,234.5 both read as 1234.5)."""
    found = []
    for raw in NUMBER.findall(text):
        value = raw.replace(",", ".")
        try:
            found.append(float(value))
        except ValueError:
            continue
    return found


def numbers_of(data: Any, out: set[float] | None = None) -> set[float]:
    """Every number in a context or tool result, plus the derived forms the model may quote: km from
    metres, minutes and hours from seconds, min/km paces, percentages."""
    out = set() if out is None else out
    if isinstance(data, bool):
        return out
    if isinstance(data, int | float):
        value = float(data)
        for derived in (value, value / 1000, value / 60, value / 3600, value * 100):
            out.add(round(derived, 1))
            out.add(round(derived))
        if value > 0:
            minutes, seconds = divmod(round(value), 60)
            out.add(float(minutes))
            out.add(float(f"{minutes}.{seconds:02d}"))  # mm:ss quoted as a decimal
            out.add(round(1000 / value / 60 * 60, 1) if value >= 0.5 else 0)  # pace from m/s
    elif isinstance(data, dict):
        for value in data.values():
            numbers_of(value, out)
    elif isinstance(data, list | tuple):
        for value in data:
            numbers_of(value, out)
    elif isinstance(data, str):
        for part in data.split("-"):  # dates: the day, month and year appear in the text
            if part.isdigit():
                out.add(float(part))
    return out


def grounded(answer: str, data: Any) -> list[float]:
    """Numbers in the answer that are not in the data (within rounding); empty when all are grounded."""
    known = numbers_of(data)
    loose: set[float] = set()
    for value in known:
        loose.add(float(round(value)))
        loose.add(round(value, 1))
    missing = []
    for value in numbers_in(answer):
        if value < IGNORED_BELOW:
            continue
        if round(value) in loose or round(value, 1) in loose:
            continue
        if any(abs(value - k) <= max(1.0, abs(k) * 0.02) for k in known):  # 2 % tolerance for rounding
            continue
        missing.append(value)
    return missing


def load_cases(path: Path = CASES) -> list[Case]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return [Case(**item) for item in raw]


def _activity(db: Session, user_id: int, which: str) -> Activity | None:
    query = select(Activity).where(Activity.user_id == user_id).order_by(Activity.start_utc.desc())
    if which.isdigit():
        activity = db.get(Activity, int(which))
        return activity if activity is not None and activity.user_id == user_id else None
    if which.startswith("latest:"):
        query = query.where(Activity.sport == which.split(":", 1)[1])
    return db.scalar(query.limit(1))


def run_summary(db: Session, llm: Llm, user_id: int, case: Case) -> Outcome:
    activity = _activity(db, user_id, case.activity)
    if activity is None:
        return Outcome(case, False, "", [f"no activity for {case.activity!r}"])
    context = activity_context(db, activity)
    completion = llm.complete(
        db,
        user_id,
        "eval",
        system=SYSTEM,
        messages=[{"role": "user", "content": user_message(context, language=case.language, units="metric")}],
        output_schema=SCHEMA,
        max_tokens=1500,
    )
    data = completion.json()
    text = f"{data.get('suggested_title', '')}. {data.get('summary', '')} " + " ".join(
        data.get("highlights") or []
    )
    problems = [f"ungrounded number {n:g}" for n in grounded(text, context)]
    if len(str(data.get("summary", "")).split(".")) > 5:
        problems.append("summary longer than three sentences")
    return Outcome(case, not problems, text, problems)


def run_coach(db: Session, llm: Llm, user_id: int, case: Case, today: str) -> Outcome:
    calls: list[dict[str, Any]] = []
    original = llm.api.messages.stream

    def recording(**params: Any) -> Any:  # keep the tool results the model saw, to check its numbers
        calls.append(params)
        return original(**params)

    llm.api.messages.stream = recording
    try:
        text, tools = answer_text(db, llm, user_id, case.question or "", language=case.language, today=today)
    except LlmError as error:
        return Outcome(case, False, "", [str(error)])
    finally:
        llm.api.messages.stream = original
    seen: list[Any] = []
    for params in calls:
        for message in params["messages"]:
            if message["role"] == "user" and isinstance(message["content"], list):
                for block in message["content"]:
                    if block.get("type") == "tool_result" and not block.get("is_error"):
                        try:
                            seen.append(json.loads(block["content"]))
                        except json.JSONDecodeError:
                            seen.append(block["content"])
    problems = []
    for name in case.expect_tools:
        if name not in tools:
            problems.append(f"did not call {name}")
    if case.expect_any and not any(word.lower() in text.lower() for word in case.expect_any):
        problems.append(f"none of {case.expect_any} in the answer")
    if seen:
        problems += [f"ungrounded number {n:g}" for n in grounded(text, seen)]
    elif numbers_in(text):
        problems.append("quoted numbers without calling a tool")
    return Outcome(case, not problems, text, problems, tools)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--cases", type=Path, default=CASES)
    parser.add_argument("--language", choices=["en", "es"])
    parser.add_argument("--only", choices=["summary", "coach"])
    parser.add_argument("--limit", type=int, help="Run only the first N matching cases")
    args = parser.parse_args(argv)
    from zankup.core.config import get_settings
    from zankup.db.session import get_engine

    settings = get_settings()
    llm = build_llm(settings)
    if llm is None:
        print("ANTHROPIC_API_KEY is not set", file=sys.stderr)
        return 2
    cases = [
        c
        for c in load_cases(args.cases)
        if (not args.language or c.language == args.language) and (not args.only or c.kind == args.only)
    ][: args.limit]
    sessions = sessionmaker(get_engine(), expire_on_commit=False)
    today = datetime.now(UTC).date().isoformat()
    outcomes: list[Outcome] = []
    with sessions() as db:
        user = db.scalar(select(User).where(User.email == settings.owner_email)) or db.scalar(select(User))
        if user is None:
            print("no user in the database", file=sys.stderr)
            return 2
        for case in cases:
            try:
                outcome = (
                    run_summary(db, llm, user.id, case)
                    if case.kind == "summary"
                    else run_coach(db, llm, user.id, case, today)
                )
            except LlmError as error:
                outcome = Outcome(case, False, "", [str(error)])
            db.commit()
            outcomes.append(outcome)
            mark = "ok  " if outcome.ok else "FAIL"
            print(f"{mark} {case.id} [{case.language}] {'; '.join(outcome.problems)}")
            if not outcome.ok:
                print(f"     {outcome.answer[:300]}")
        spent = llm.month_cost(db, user.id)
    passed = sum(1 for o in outcomes if o.ok)
    print(f"\n{passed}/{len(outcomes)} passed · {spent:.4f} USD spent this month")
    return 0 if passed == len(outcomes) else 1


if __name__ == "__main__":
    sys.exit(main())
