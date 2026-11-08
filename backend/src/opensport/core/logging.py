"""Structured logging on the standard library.

Production writes one JSON object per line (Railway parses them); development writes readable lines.
Extra fields go through `extra=`: `log.info("sync finished", extra={"new": 3, "duration_ms": 812})`.
"""

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any, Literal

# Attributes every LogRecord has; anything else came in through `extra=`.
_STANDARD = set(vars(logging.makeLogRecord({}))) | {"message", "asctime", "taskName", "color_message"}


def _extras(record: logging.LogRecord) -> dict[str, Any]:
    return {k: v for k, v in vars(record).items() if k not in _STANDARD and not k.startswith("_")}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
            **_extras(record),
        }
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False, default=str)


class ConsoleFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        time = datetime.fromtimestamp(record.created).strftime("%H:%M:%S")
        extras = " ".join(f"{k}={v}" for k, v in _extras(record).items())
        line = f"{time} {record.levelname:<7} {record.name}: {record.getMessage()}" + (
            f"  {extras}" if extras else ""
        )
        if record.exc_info:
            line += "\n" + self.formatException(record.exc_info)
        return line


def configure_logging(level: str = "INFO", fmt: Literal["json", "console"] = "console") -> None:
    """Send every log (ours, uvicorn's, libraries') through one handler on stdout."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if fmt == "json" else ConsoleFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True
