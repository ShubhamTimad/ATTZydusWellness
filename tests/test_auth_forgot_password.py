from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from db.base import Base
from modules.platform.auth.service import AuthService
from modules.platform.users.model import User


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    with SessionLocal() as session:
        yield session


def test_forgot_password_includes_expiry_minutes_in_email_payload(
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = User(
        full_name="Alice Example",
        username="alice.example",
        email="alice@example.com",
        phone="+15550000001",
        hashed_password="not-used-here",
        password_changed_at=datetime.now(timezone.utc),
        is_active=True,
        is_superuser=False,
    )
    db.add(user)
    db.commit()

    captured: dict[str, object] = {}

    class StubEmailNotificationService:
        def __init__(self, db: Session) -> None:
            self._db = db

        def trigger_event(self, *, event_code: str, payload: dict[str, object]) -> SimpleNamespace:
            captured["event_code"] = event_code
            captured["payload"] = payload
            return SimpleNamespace(status="sent", error=None)

    monkeypatch.setenv("PASSWORD_RESET_TOKEN_EXPIRE_MINUTES", "45")
    monkeypatch.setenv("FRONTEND_APP_URL", "https://app.example.com")
    monkeypatch.setattr(
        "modules.platform.auth.service.EmailNotificationService",
        StubEmailNotificationService,
    )

    AuthService(db).forgot_password(email="alice@example.com")

    assert captured["event_code"] == "FORGOT_PASSWORD"
    payload = captured["payload"]
    assert isinstance(payload, dict)
    assert payload["user_name"] == "Alice Example"
    assert payload["email"] == "alice@example.com"
    assert payload["expiry_minutes"] == 45
    assert payload["reset_link"].startswith("https://app.example.com/reset-password?token=")


def test_forgot_password_route_reports_unregistered_email(
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    from fastapi import HTTPException

    from modules.platform.auth.routes import forgot_password
    from modules.platform.auth.schema import ForgotPasswordRequest

    monkeypatch.setenv("RATE_LIMIT_STATE_PATH", str(tmp_path / "limits.json"))
    request = SimpleNamespace(client=SimpleNamespace(host="203.0.113.9"))
    with pytest.raises(HTTPException) as exc:
        forgot_password(request, ForgotPasswordRequest(email="nobody@example.com"), AuthService(db))
    assert exc.value.status_code == 404
    assert exc.value.detail == "No account found with this email address."
