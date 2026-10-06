"""Reject API calls when the server-side session exceeded the configured idle period."""

from __future__ import annotations

from typing import Callable

from fastapi.responses import JSONResponse
from jose import JWTError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from core.security import decode_access_token
from core.session_idle import (
    SessionIdleExpiredError,
    SessionRevokedError,
    touch_session_from_access_claims,
)
from db.session import SessionLocal

_SKIP_PREFIXES = (
    "/login",
    "/refresh",
    "/auth/policy",
    "/auth/session-policy",
    "/auth/app-version",
    "/auth/login-background",
    "/auth/brand-logo",
    "/auth/sso",
    "/forgot-password",
    "/reset-password",
    "/docs",
    "/openapi.json",
    "/redoc",
)


def _should_skip(path: str) -> bool:
    if path in ("/", "/health"):
        return True
    for prefix in _SKIP_PREFIXES:
        if path == prefix or path.startswith(prefix + "/"):
            return True
    return False


def _access_claims(request: Request) -> dict | None:
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if not auth or not auth.lower().startswith("bearer "):
        return None
    parts = auth.split(None, 1)
    if len(parts) != 2:
        return None
    try:
        return decode_access_token(parts[1])
    except JWTError:
        return None


class SessionIdleMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path
        if request.method == "OPTIONS" or _should_skip(path):
            return await call_next(request)
        claims = _access_claims(request)
        if claims is None:
            return await call_next(request)
        db = SessionLocal()
        try:
            touch_session_from_access_claims(db, claims)
        except SessionIdleExpiredError:
            return JSONResponse(
                status_code=401,
                content={"detail": "session_idle"},
                headers={"WWW-Authenticate": "Bearer"},
            )
        except SessionRevokedError:
            return JSONResponse(
                status_code=401,
                content={"detail": "session_revoked"},
                headers={"WWW-Authenticate": "Bearer"},
            )
        finally:
            db.close()
        return await call_next(request)
