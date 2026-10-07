"""Email ERROR (and CRITICAL) log records to the addresses in ERROR_ALERT_EMAILS.

Enabled by configure_logging() when ERROR_ALERT_EMAILS is set. Uses the same SMTP
settings as other app emails (Admin → Settings, else SMTP_* env); when the database
is unreachable it falls back to SMTP_* env so "database down" still alerts.

ponytail: throttle state lives in memory per worker process, so with N uvicorn
workers one error can mail up to N times per window. Move the throttle to Postgres
or Redis if that gets noisy.
"""

from __future__ import annotations

import html
import logging
import os
import socket
import sys
import threading
import time
import traceback
from collections import deque
from datetime import datetime, timezone
from urllib.parse import urlparse

from core.request_context import get_request_id, get_user_id

_THREAD_NAME = "error-alert"
_MAX_EMAILS_PER_HOUR = 30
_CONTEXT_FIELDS = ("event", "method", "path", "status_code", "error_type")


def _env_int(name: str, default: int) -> int:
    try:
        return int((os.environ.get(name) or "").strip() or default)
    except ValueError:
        return default


def _environment_label() -> str:
    url = (os.environ.get("FRONTEND_APP_URL") or "").strip()
    return urlparse(url).netloc or socket.gethostname()


def _fingerprint(record: logging.LogRecord) -> str:
    if record.exc_info and record.exc_info[1] is not None:
        exc = record.exc_info[1]
        frames = traceback.extract_tb(exc.__traceback__)
        where = f"{frames[-1].filename}:{frames[-1].lineno}" if frames else ""
        return f"{record.name}|{type(exc).__name__}|{where}"
    return f"{record.name}|{record.pathname}:{record.lineno}|{record.getMessage()[:200]}"


def _smtp_config():
    from modules.platform.settings.smtp_config import SmtpConfig, get_smtp_config, normalize_smtp_host

    try:
        return get_smtp_config()
    except Exception:
        host = normalize_smtp_host(os.environ.get("SMTP_HOST") or "")
        user = (os.environ.get("SMTP_USERNAME") or "").strip() or None
        from_email = (os.environ.get("SMTP_FROM_EMAIL") or "").strip() or (user or "")
        if not host or not from_email:
            return None
        return SmtpConfig(
            host=host,
            port=_env_int("SMTP_PORT", 587),
            username=user,
            password=(os.environ.get("SMTP_PASSWORD") or "").strip() or None,
            use_tls=(os.environ.get("SMTP_USE_TLS") or "true").strip().lower() in {"1", "true", "yes", "on"},
            from_email=from_email,
            from_name=(os.environ.get("SMTP_FROM_NAME") or "").strip(),
        )


def _send_all(recipients: list[str], subject: str, body: str) -> None:
    # Never log from here: a failure would raise another ERROR and re-enter the handler.
    try:
        from modules.platform.emails.smtp_transport import send_via_smtp

        cfg = _smtp_config()
        if cfg is None:
            sys.stderr.write("error_alert_not_sent: SMTP is not configured\n")
            return
        for to in recipients:
            send_via_smtp(cfg, to_email=to, subject=subject, body=body)
    except Exception as exc:
        sys.stderr.write(f"error_alert_not_sent: {exc}\n")


def build_email(record: logging.LogRecord, *, repeats: int) -> tuple[str, str]:
    env = _environment_label()
    exc = record.exc_info[1] if record.exc_info else None
    headline = f"{type(exc).__name__}: {exc}" if exc is not None else record.getMessage()
    where = getattr(record, "path", None)
    subject = f"[{env}] {record.levelname}: {headline}"[:180] + (f" at {where}" if where else "")
    request_id = getattr(record, "request_id", None) or get_request_id()

    rows = [
        ("Environment", env),
        ("Time (UTC)", datetime.fromtimestamp(record.created, timezone.utc).strftime("%Y-%m-%d %H:%M:%S")),
        ("Level", record.levelname),
        ("Message", record.getMessage()),
        ("Logger", record.name),
        ("Source", f"{record.pathname}:{record.lineno}"),
        ("Request ID", request_id),
        ("User ID", getattr(record, "user_id", None) or get_user_id()),
    ]
    rows += [(k.replace("_", " ").title(), getattr(record, k)) for k in _CONTEXT_FIELDS if hasattr(record, k)]
    if repeats:
        rows.append(("Repeats not emailed", f"{repeats} since the previous alert for this error"))

    table = "".join(
        f"<tr><td style='padding:4px 12px 4px 0;color:#555;vertical-align:top'><b>{html.escape(str(k))}</b></td>"
        f"<td style='padding:4px 0'>{html.escape(str(v))}</td></tr>"
        for k, v in rows
    )
    tb = ""
    if record.exc_info:
        tb = "".join(traceback.format_exception(*record.exc_info))
    elif record.exc_text:
        tb = record.exc_text
    tb_html = (
        f"<h3 style='margin:16px 0 4px'>Traceback</h3>"
        f"<pre style='background:#f6f8fa;padding:12px;font-size:12px;white-space:pre-wrap'>{html.escape(tb)}</pre>"
        if tb
        else ""
    )
    body = (
        "<div style='font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:14px'>"
        f"<h2 style='color:#b42318;margin:0 0 12px'>Application error on {html.escape(env)}</h2>"
        f"<table>{table}</table>{tb_html}"
        "<p style='color:#555;margin-top:16px'>Full request log: "
        f"<code>docker compose logs backend | grep {html.escape(str(request_id))}</code></p>"
        "</div>"
    )
    return subject, body


class ErrorEmailHandler(logging.Handler):
    def __init__(self, recipients: list[str]) -> None:
        super().__init__(level=logging.ERROR)
        self.recipients = recipients
        self.throttle_sec = _env_int("ERROR_ALERT_THROTTLE_SECONDS", 900)
        self._lock = threading.Lock()
        self._last_sent: dict[str, float] = {}
        self._repeats: dict[str, int] = {}
        self._recent: deque[float] = deque()

    def emit(self, record: logging.LogRecord) -> None:
        if threading.current_thread().name == _THREAD_NAME:
            return
        try:
            key = _fingerprint(record)
            now = time.monotonic()
            with self._lock:
                last = self._last_sent.get(key)
                while self._recent and now - self._recent[0] > 3600:
                    self._recent.popleft()
                if (last is not None and now - last < self.throttle_sec) or len(self._recent) >= _MAX_EMAILS_PER_HOUR:
                    self._repeats[key] = self._repeats.get(key, 0) + 1
                    return
                self._last_sent[key] = now
                self._recent.append(now)
                repeats = self._repeats.pop(key, 0)
            subject, body = build_email(record, repeats=repeats)
            self._dispatch(subject, body)
        except Exception:
            self.handleError(record)

    def _dispatch(self, subject: str, body: str) -> None:
        threading.Thread(
            target=_send_all, args=(self.recipients, subject, body), name=_THREAD_NAME, daemon=True
        ).start()
