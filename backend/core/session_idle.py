"""Enforce and update server-side session idle based on access-token ``jti``."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from modules.platform.auth.model import UserSession
from modules.platform.settings.session_idle import get_session_idle_timeout_minutes


class SessionIdleExpiredError(Exception):
    """Refresh or access use after configured idle period."""


def _session_idle_seconds() -> float:
    return float(get_session_idle_timeout_minutes() * 60)


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _effective_last_activity(row: UserSession) -> datetime:
    last = getattr(row, "last_activity_at", None)
    if last is not None:
        return _as_utc(last)
    return _as_utc(row.created_at)


def touch_session_from_access_claims(db: Session, claims: dict) -> None:
    """
    Reject if idle exceeded; otherwise bump ``last_activity_at``.

    Tokens without ``jti`` are ignored (legacy sessions expire via JWT ``exp`` only).
    """
    jti = claims.get("jti")
    if not isinstance(jti, str) or not jti.strip():
        return
    now = datetime.now(timezone.utc)
    row = db.scalar(
        select(UserSession).where(
            UserSession.refresh_jti == jti,
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > now,
        )
    )
    if row is None:
        return
    last = _effective_last_activity(row)
    if (now - last).total_seconds() > _session_idle_seconds():
        row.revoked_at = now
        db.commit()
        raise SessionIdleExpiredError
    row.last_activity_at = now
    db.commit()


def assert_refresh_session_active(db: Session, row: UserSession) -> None:
    """Called before rotating refresh tokens."""
    now = datetime.now(timezone.utc)
    last = _effective_last_activity(row)
    if (now - last).total_seconds() > _session_idle_seconds():
        row.revoked_at = now
        db.commit()
        raise SessionIdleExpiredError
    row.last_activity_at = now
