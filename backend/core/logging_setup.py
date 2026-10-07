"""Central technical logging: one stream, structured fields, no per-user files.

Configure once at process start via ``configure_logging()``.
Env:
  LOG_LEVEL   — DEBUG | INFO | WARNING | ERROR (default INFO)
  LOG_FORMAT  — json | text (default json when not a TTY, else text)
  LOG_FILE    — optional path; same events also always go to stdout
  ERROR_ALERT_EMAILS — optional comma-separated addresses; ERROR+ records are emailed (core.error_alerts)
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from typing import Any

from core.request_context import get_request_id, get_user_id

_CONFIGURED = False


class ContextFilter(logging.Filter):
    """Inject request_id / user_id from contextvars onto every record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id()  # type: ignore[attr-defined]
        record.user_id = get_user_id()  # type: ignore[attr-defined]
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
            "level": record.levelname,
            "logger": record.name,
            "request_id": getattr(record, "request_id", "-"),
            "user_id": getattr(record, "user_id", "-"),
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        # Structured extras passed as logger.info("…", extra={…}) — skip LogRecord builtins.
        skip = {
            "name",
            "msg",
            "args",
            "levelname",
            "levelno",
            "pathname",
            "filename",
            "module",
            "exc_info",
            "exc_text",
            "stack_info",
            "lineno",
            "funcName",
            "created",
            "msecs",
            "relativeCreated",
            "thread",
            "threadName",
            "processName",
            "process",
            "message",
            "request_id",
            "user_id",
            "taskName",
        }
        for key, value in record.__dict__.items():
            if key in skip or key.startswith("_"):
                continue
            try:
                json.dumps(value)
                payload[key] = value
            except (TypeError, ValueError):
                payload[key] = repr(value)
        return json.dumps(payload, ensure_ascii=False)


class TextFormatter(logging.Formatter):
    def __init__(self) -> None:
        super().__init__(
            fmt="%(asctime)s %(levelname)s [%(request_id)s u=%(user_id)s] %(name)s: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )


def _resolve_level() -> int:
    raw = (os.environ.get("LOG_LEVEL") or "INFO").strip().upper()
    return getattr(logging, raw, logging.INFO)


def _resolve_format() -> str:
    raw = (os.environ.get("LOG_FORMAT") or "").strip().lower()
    if raw in ("json", "text"):
        return raw
    return "text" if sys.stderr.isatty() else "json"


def configure_logging() -> None:
    """Idempotent: safe to call more than once."""
    global _CONFIGURED
    if _CONFIGURED:
        return

    level = _resolve_level()
    fmt_name = _resolve_format()
    formatter: logging.Formatter = JsonFormatter() if fmt_name == "json" else TextFormatter()
    ctx = ContextFilter()

    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(level)
    root.addFilter(ctx)

    stdout = logging.StreamHandler(sys.stdout)
    stdout.setLevel(level)
    stdout.setFormatter(formatter)
    stdout.addFilter(ctx)
    root.addHandler(stdout)

    log_file = (os.environ.get("LOG_FILE") or "").strip()
    if log_file:
        parent = os.path.dirname(log_file)
        if parent:
            os.makedirs(parent, exist_ok=True)
        file_handler = RotatingFileHandler(
            log_file,
            maxBytes=10 * 1024 * 1024,
            backupCount=5,
            encoding="utf-8",
        )
        file_handler.setLevel(level)
        file_handler.setFormatter(formatter)
        file_handler.addFilter(ctx)
        root.addHandler(file_handler)

    alert_to = [e.strip() for e in (os.environ.get("ERROR_ALERT_EMAILS") or "").split(",") if e.strip()]
    if alert_to:
        from core.error_alerts import ErrorEmailHandler

        alerts = ErrorEmailHandler(alert_to)
        alerts.addFilter(ctx)
        root.addHandler(alerts)

    # Quiet noisy libraries; keep WARNING+.
    for name in ("uvicorn.access", "httpx", "httpcore", "asyncio"):
        logging.getLogger(name).setLevel(logging.WARNING)

    _CONFIGURED = True
    logging.getLogger(__name__).info(
        "logging_configured",
        extra={"event": "logging_configured", "log_format": fmt_name, "log_level": logging.getLevelName(level)},
    )
