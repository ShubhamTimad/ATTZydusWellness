from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from core.session_idle import SessionIdleExpiredError, touch_session_from_access_claims
from db.base import Base
from modules.asset_masters.model import AssetConditionMaster  # noqa: F401
from modules.platform.auth.model import UserSession
from modules.platform.mfa.model import UserMfa  # noqa: F401
from modules.platform.users.model import User


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    with SessionLocal() as session:
        yield session


def _session_row(db: Session, *, last_activity_at: datetime) -> UserSession:
    now = datetime.now(timezone.utc)
    user = User(
        full_name="Idle Test",
        username="idle.test",
        email="idle@example.com",
        phone="9876500001",
        hashed_password="x",
        password_changed_at=now,
        is_active=True,
        is_superuser=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    jti = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    row = UserSession(
        user_id=user.id,
        refresh_jti=jti,
        expires_at=now + timedelta(days=7),
        last_activity_at=last_activity_at,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def test_touch_session_extends_recent_activity(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "core.session_idle.idle_policy_for_auth_method",
        lambda _method: (True, 10),
    )
    now = datetime.now(timezone.utc)
    row = _session_row(db, last_activity_at=now - timedelta(minutes=2))
    touch_session_from_access_claims(db, {"jti": row.refresh_jti})
    db.refresh(row)
    assert row.revoked_at is None
    assert row.last_activity_at is not None
    last = row.last_activity_at
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    assert last >= now - timedelta(seconds=5)


def test_touch_session_revokes_when_idle_exceeded(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "core.session_idle.idle_policy_for_auth_method",
        lambda _method: (True, 10),
    )
    now = datetime.now(timezone.utc)
    row = _session_row(db, last_activity_at=now - timedelta(minutes=11))
    with pytest.raises(SessionIdleExpiredError):
        touch_session_from_access_claims(db, {"jti": row.refresh_jti})
    db.refresh(row)
    assert row.revoked_at is not None


def test_touch_session_skips_idle_for_sso_when_disabled(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "core.session_idle.idle_policy_for_auth_method",
        lambda method: (False, 0) if method == "sso" else (True, 10),
    )
    now = datetime.now(timezone.utc)
    row = _session_row(db, last_activity_at=now - timedelta(minutes=11))
    row.auth_method = "sso"
    db.commit()
    touch_session_from_access_claims(db, {"jti": row.refresh_jti})
    db.refresh(row)
    assert row.revoked_at is None
