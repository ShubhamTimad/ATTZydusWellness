"""Optional Sentry error + performance monitoring.

No-op when ``SENTRY_DSN`` is unset. Call ``init_sentry()`` once before creating the FastAPI app.
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

_ENABLED = False


def sentry_enabled() -> bool:
    return _ENABLED


def _float_env(name: str, default: float) -> float:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return max(0.0, min(1.0, value))


def _before_send(event: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any] | None:
    """Drop noisy client errors; scrub common secret-shaped request data."""
    exc_info = hint.get("exc_info")
    if exc_info:
        exc = exc_info[1]
        # Starlette/FastAPI HTTPException — only report server errors.
        status = getattr(exc, "status_code", None)
        if isinstance(status, int) and status < 500:
            return None

    request = event.get("request") or {}
    headers = request.get("headers")
    if isinstance(headers, dict):
        for key in list(headers):
            lower = key.lower()
            if lower in ("authorization", "cookie", "x-api-key"):
                headers[key] = "[Filtered]"
    return event


def init_sentry() -> bool:
    """Initialize Sentry if ``SENTRY_DSN`` is set. Idempotent via module flag."""
    global _ENABLED
    if _ENABLED:
        return True

    dsn = (os.environ.get("SENTRY_DSN") or "").strip()
    if not dsn:
        logger.info("sentry_disabled", extra={"event": "sentry_disabled", "reason": "no_dsn"})
        return False

    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.logging import LoggingIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration

    environment = (os.environ.get("SENTRY_ENVIRONMENT") or os.environ.get("ENVIRONMENT") or "development").strip()
    release = (os.environ.get("SENTRY_RELEASE") or "").strip() or None
    traces = _float_env("SENTRY_TRACES_SAMPLE_RATE", 0.1)
    profiles = _float_env("SENTRY_PROFILES_SAMPLE_RATE", 0.0)
    server_name = (os.environ.get("SENTRY_SERVER_NAME") or "").strip() or None

    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=release,
        server_name=server_name,
        traces_sample_rate=traces,
        profiles_sample_rate=profiles,
        send_default_pii=False,
        before_send=_before_send,
        integrations=[
            StarletteIntegration(transaction_style="endpoint"),
            FastApiIntegration(transaction_style="endpoint"),
            SqlalchemyIntegration(),
            # Errors/exceptions via SDK; don't duplicate every log line as a Sentry event.
            LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
        ],
    )
    _ENABLED = True
    logger.info(
        "sentry_configured",
        extra={
            "event": "sentry_configured",
            "environment": environment,
            "traces_sample_rate": traces,
            "profiles_sample_rate": profiles,
            "server_name": server_name or "-",
        },
    )
    return True


def set_request_scope(*, request_id: str, user_id: str | int | None = None) -> None:
    if not _ENABLED:
        return
    import sentry_sdk

    sentry_sdk.set_tag("request_id", request_id or "-")
    if user_id is not None and str(user_id) not in ("", "-"):
        sentry_sdk.set_user({"id": str(user_id)})
        sentry_sdk.set_tag("user_id", str(user_id))
    else:
        sentry_sdk.set_user(None)
        sentry_sdk.set_tag("user_id", "-")


def capture_exception(exc: BaseException) -> None:
    if not _ENABLED:
        return
    import sentry_sdk

    sentry_sdk.capture_exception(exc)


def clear_request_scope() -> None:
    if not _ENABLED:
        return
    import sentry_sdk

    sentry_sdk.set_user(None)
