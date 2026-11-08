import json
import logging

import pytest

from zankup.core.config import Settings
from zankup.core.logging import ConsoleFormatter, JsonFormatter


def test_settings_read_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("DATA_DIR", "/data")
    monkeypatch.setenv("GARMIN_PERSONAL_API_KEY", "super-secret-key")
    settings = Settings(_env_file=None)  # type: ignore[call-arg]
    assert settings.is_production
    assert settings.effective_log_format == "json"
    assert str(settings.raw_dir) == "/data/raw"
    assert settings.integrations() == {
        "garmin": True,
        "email": False,
        "backups": False,
        "google_sign_in": False,
        "ai": False,
    }


def test_secrets_never_show_up(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET", "super-secret-value")
    settings = Settings(_env_file=None)  # type: ignore[call-arg]
    assert "super-secret-value" not in repr(settings)
    assert "super-secret-value" not in settings.model_dump_json()
    assert settings.jwt_secret is not None and settings.jwt_secret.get_secret_value() == "super-secret-value"


def test_development_defaults_to_console_logs() -> None:
    assert Settings(_env_file=None).effective_log_format == "console"  # type: ignore[call-arg]


def _record(**extra: object) -> logging.LogRecord:
    record = logging.makeLogRecord({"name": "zankup.sync", "levelname": "INFO", "levelno": 20, "msg": "done"})
    record.__dict__.update(extra)
    return record


def test_json_logs_carry_extra_fields() -> None:
    entry = json.loads(JsonFormatter().format(_record(new=3, duration_ms=812)))
    assert entry["level"] == "info" and entry["logger"] == "zankup.sync" and entry["message"] == "done"
    assert entry["new"] == 3 and entry["duration_ms"] == 812


def test_console_logs_are_readable() -> None:
    line = ConsoleFormatter().format(_record(new=3))
    assert "INFO" in line and "zankup.sync: done" in line and "new=3" in line
