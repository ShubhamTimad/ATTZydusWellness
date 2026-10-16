"""Enforce and update server-side session idle based on access-token ``jti``."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from modules.platform.auth.model import UserSession
from modules.platform.settings.session_idle import idle_policy_for_auth_method


class SessionIdleExpiredError(Exception):
    """Refresh or access use after configured idle period."""


class SessionRevokedError(Exception):
    """Access token whose server session was revoked or never issued."""


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _effective_last_activity(row: UserSession) -> datetime:
    last = getattr(row, "last_activity_at", None)
    if last is not None:
        return _as_utc(last)
    return _as_utc(row.created_at)


def _idle_seconds_for_row(row: UserSession) -> float | None:
    """None means idle enforcement is disabled for this session."""
    enabled, minutes = idle_policy_for_auth_method(getattr(row, "auth_method", None))
    if not enabled or minutes < 1:
        return None
    return float(minutes * 60)


def touch_session_from_access_claims(db: Session, claims: dict) -> None:
    """
    Reject if idle exceeded; otherwise bump ``last_activity_at``.

    Tokens without ``jti`` are ignored (legacy sessions expire via JWT ``exp`` only).
    SSO sessions skip idle when Session idle → Apply to SSO is off.
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
        raise SessionRevokedError
    idle_seconds = _idle_seconds_for_row(row)
    if idle_seconds is None:
        row.last_activity_at = now
        db.commit()
        return
    last = _effective_last_activity(row)
    if (now - last).total_seconds() > idle_seconds:
        row.revoked_at = now
        db.commit()
        raise SessionIdleExpiredError
    row.last_activity_at = now
    db.commit()


def revoke_all_sessions(db: Session, user_id: int) -> None:
    now = datetime.now(timezone.utc)
    db.execute(
        update(UserSession)
        .where(UserSession.user_id == int(user_id), UserSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )


def assert_refresh_session_active(db: Session, row: UserSession) -> None:
    """Called before rotating refresh tokens."""
    now = datetime.now(timezone.utc)
    idle_seconds = _idle_seconds_for_row(row)
    if idle_seconds is None:
        row.last_activity_at = now
        return
    last = _effective_last_activity(row)
    if (now - last).total_seconds() > idle_seconds:
        row.revoked_at = now
        db.commit()
        raise SessionIdleExpiredError
    row.last_activity_at = now
