"""Central technical logging: one stream, structured fields, no per-user files.

Configure once at process start via ``configure_logging()``.
Env:
  LOG_LEVEL   — DEBUG | INFO | WARNING | ERROR (default INFO)
  LOG_FORMAT  — json | text (default json when not a TTY, else text)
  LOG_DIR     — optional directory; daily files per category (see _LOG_FILES). stdout always on
  LOG_RETENTION_DAYS — days of daily files to keep (default 30)
  ERROR_ALERT_EMAILS — optional comma-separated addresses; ERROR+ records are emailed (core.error_alerts)
"""

from __future__ import annotations

import glob
import json
import logging
import os
import sys
from datetime import date, datetime, timezone
from typing import Any

from core.request_context import get_request_id, get_user_id

_CONFIGURED = False

# (folder/file prefix, minimum level or None for LOG_LEVEL, logger-name prefixes or None for all)
_LOG_FILES: tuple[tuple[str, int | None, tuple[str, ...] | None], ...] = (
    ("all", None, None),
    ("access", None, ("app.access",)),
    ("error", logging.WARNING, None),
    ("auth", None, ("modules.platform.auth", "core.captcha")),
)


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


def _utc_today() -> date:
    return datetime.now(timezone.utc).date()


class DailyFileHandler(logging.FileHandler):
    """Append to ``<directory>/<prefix>-YYYY-MM-DD.log`` (UTC day).

    Never renames files, so several uvicorn workers can safely append to the same file.
    Files older than ``retention_days`` are deleted at startup and at each day change.
    """

    def __init__(self, directory: str, prefix: str, retention_days: int) -> None:
        os.makedirs(directory, exist_ok=True)
        self.directory = directory
        self.prefix = prefix
        self.retention_days = retention_days
        self.day = _utc_today()
        super().__init__(self._path(), encoding="utf-8", delay=True)
        self._purge_old()

    def _path(self) -> str:
        return os.path.join(self.directory, f"{self.prefix}-{self.day.isoformat()}.log")

    def emit(self, record: logging.LogRecord) -> None:
        today = _utc_today()
        if today != self.day:
            if self.stream:
                self.stream.close()
                self.stream = None  # type: ignore[assignment]
            self.day = today
            self.baseFilename = os.path.abspath(self._path())
            self._purge_old()
        super().emit(record)

    def _purge_old(self) -> None:
        start = len(self.prefix) + 1
        for path in glob.glob(os.path.join(self.directory, f"{self.prefix}-*.log")):
            try:
                day = date.fromisoformat(os.path.basename(path)[start:-4])
                if (self.day - day).days >= self.retention_days:
                    os.remove(path)
            except (ValueError, OSError):
                continue


def _resolve_retention_days() -> int:
    try:
        return max(1, int((os.environ.get("LOG_RETENTION_DAYS") or "30").strip()))
    except ValueError:
        return 30


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

    log_dir = (os.environ.get("LOG_DIR") or "").strip()
    if log_dir:
        retention_days = _resolve_retention_days()
        for name, min_level, prefixes in _LOG_FILES:
            file_handler = DailyFileHandler(os.path.join(log_dir, name), name, retention_days)
            file_handler.setLevel(max(level, min_level or level))
            file_handler.setFormatter(formatter)
            file_handler.addFilter(ctx)
            if prefixes:
                file_handler.addFilter(lambda r, p=prefixes: r.name.startswith(p))
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
        extra={
            "event": "logging_configured",
            "log_format": fmt_name,
            "log_level": logging.getLevelName(level),
            "log_dir": log_dir or None,
        },
    )
