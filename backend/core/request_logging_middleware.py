"""Attach request_id to every request and emit one access log line per call."""

from __future__ import annotations

import logging
import time
import uuid
from typing import Callable

from jose import JWTError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from core.request_context import clear_request_context, set_request_id, set_user_id
from core.security import decode_access_token
from core.sentry_setup import clear_request_scope, set_request_scope

logger = logging.getLogger("app.access")

_HEADER = "X-Request-ID"

# High-churn paths: still get a request_id, but access line is DEBUG.
_QUIET_PREFIXES = ("/docs", "/openapi.json", "/redoc", "/health")


def _new_request_id(request: Request) -> str:
    incoming = (request.headers.get(_HEADER) or request.headers.get("x-request-id") or "").strip()
    if incoming and len(incoming) <= 128 and all(c.isalnum() or c in "-_" for c in incoming):
        return incoming
    return uuid.uuid4().hex[:16]


def _user_id_from_auth(request: Request) -> int | None:
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if not auth or not auth.lower().startswith("bearer "):
        return None
    parts = auth.split(None, 1)
    if len(parts) != 2:
        return None
    try:
        payload = decode_access_token(parts[1])
        sub = payload.get("sub")
        if sub is None:
            return None
        return int(sub) if isinstance(sub, str) else int(sub)
    except (JWTError, ValueError, TypeError):
        return None


def _is_quiet(path: str) -> bool:
    for prefix in _QUIET_PREFIXES:
        if path == prefix or path.startswith(prefix + "/"):
            return True
    return False


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        rid = _new_request_id(request)
        uid = _user_id_from_auth(request)
        set_request_id(rid)
        set_user_id(uid)
        set_request_scope(request_id=rid, user_id=uid)
        request.state.request_id = rid

        started = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            response.headers[_HEADER] = rid
            return response
        except Exception:
            logger.exception(
                "request_unhandled_error",
                extra={
                    "event": "request_unhandled_error",
                    "method": request.method,
                    "path": request.url.path,
                },
            )
            raise
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 1)
            extra = {
                "event": "http_request",
                "method": request.method,
                "path": request.url.path,
                "status_code": status_code,
                "duration_ms": duration_ms,
            }
            msg = f"{request.method} {request.url.path} → {status_code} {duration_ms}ms"
            if _is_quiet(request.url.path):
                logger.debug(msg, extra=extra)
            elif status_code >= 500:
                logger.error(msg, extra=extra)
            elif status_code >= 400:
                logger.warning(msg, extra=extra)
            else:
                logger.info(msg, extra=extra)
            clear_request_scope()
            clear_request_context()
