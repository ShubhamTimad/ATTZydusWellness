from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from db.base import Base
from modules.asset_masters.model import AssetConditionMaster  # noqa: F401 — FK target for create_all
from modules.platform.auth.model import PasswordResetToken, UserSession
from modules.platform.auth.service import AuthService, InvalidRefreshTokenError
from modules.platform.emails.model import EmailLog, EmailTemplate, EmailTemplateMapping
from modules.platform.emails.service import EmailNotificationService
from modules.platform.org_units.model import OrgUnit
from modules.platform.roles.model import Role
from modules.platform.users.model import User
from modules.platform.users.schema import UserCreate, UserUpdate
from modules.platform.users.service import UserService


class StubSender:
    def __init__(self) -> None:
        self.calls: list[dict[str, str]] = []

    def send_email(self, *, to_email: str, subject: str, body: str, cfg=None) -> None:  # noqa: ANN001
        self.calls.append({"to_email": to_email, "subject": subject, "body": body})


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    with SessionLocal() as session:
        yield session


def _seed_role_plant(db: Session) -> tuple[Role, OrgUnit]:
    plant = OrgUnit(name="Plant A", code="PLT-A", type="PLANT")
    role = Role(name="Operator", description=None)
    db.add_all([plant, role])
    db.commit()
    db.refresh(plant)
    db.refresh(role)
    return role, plant


def test_create_inactive_user_skips_welcome_email(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    role, plant = _seed_role_plant(db)
    calls: list[str] = []

    class StubEmailNotificationService:
        def __init__(self, db: Session) -> None:
            self._db = db

        def trigger_event(self, *, event_code: str, payload: dict[str, object]) -> SimpleNamespace:
            calls.append(event_code)
            return SimpleNamespace(status="sent", error=None)

    monkeypatch.setattr(
        "modules.platform.users.service.EmailNotificationService",
        StubEmailNotificationService,
    )
    monkeypatch.setattr(
        "modules.platform.users.service.maybe_send_mfa_setup_for_user",
        lambda *_a, **_k: None,
    )

    user = UserService(db).create_user(
        UserCreate(
            full_name="Inactive User",
            username="inactive.user",
            phone="9876543210",
            email="inactive@example.com",
            role_id=role.id,
            org_unit_ids=[plant.id],
            is_active=False,
        )
    )
    assert user.is_active is False
    assert calls == []


def test_trigger_event_skips_inactive_recipient(db: Session) -> None:
    user = User(
        full_name="Inactive",
        username="inactive.mail",
        email="inactive@example.com",
        phone="9876543211",
        hashed_password="x",
        password_changed_at=datetime.now(timezone.utc),
        is_active=False,
        is_superuser=False,
    )
    template = EmailTemplate(
        name="Forgot password",
        event_code="FORGOT_PASSWORD",
        subject="Reset",
        body_html="<p>{{user_name}}</p><p>{{reset_link}}</p>",
        body_text=None,
        is_active=True,
    )
    db.add_all([user, template])
    db.commit()
    db.refresh(template)
    db.add(EmailTemplateMapping(event_code="FORGOT_PASSWORD", template_id=template.id, is_enabled=True))
    db.commit()

    sender = StubSender()
    result = EmailNotificationService(db, sender=sender).trigger_event(
        event_code="FORGOT_PASSWORD",
        payload={
            "user_name": "Inactive",
            "email": "inactive@example.com",
            "reset_link": "https://example.com/reset",
        },
    )
    assert result.status == "skipped"
    assert result.error == "Recipient account is inactive"
    assert sender.calls == []


def test_deactivate_revokes_sessions_and_reset_tokens(db: Session) -> None:
    role, plant = _seed_role_plant(db)
    user = UserService(db).create_user(
        UserCreate(
            full_name="Active User",
            username="active.user",
            phone="9876543212",
            email="active@example.com",
            role_id=role.id,
            org_unit_ids=[plant.id],
        )
    )
    # Create always drafts (inactive); activate so the deactivate transition is exercised.
    user.is_active = True
    db.commit()
    now = datetime.now(timezone.utc)
    session = UserSession(
        user_id=user.id,
        refresh_jti="11111111-1111-1111-1111-111111111111",
        expires_at=now + timedelta(days=7),
        last_activity_at=now,
    )
    reset = PasswordResetToken(
        user_id=user.id,
        token_hash="a" * 64,
        expires_at=now + timedelta(minutes=30),
    )
    db.add_all([session, reset])
    db.commit()

    UserService(db).update_user(user.id, UserUpdate(is_active=False), actor_user_id=1)

    db.refresh(session)
    db.refresh(reset)
    assert session.revoked_at is not None
    assert reset.used_at is not None


def test_reset_password_rejects_inactive_user(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime.now(timezone.utc)
    user = User(
        full_name="Inactive",
        username="inactive.reset",
        email="reset-inactive@example.com",
        phone="9876543213",
        hashed_password="old",
        password_changed_at=now,
        is_active=False,
        is_superuser=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    import hashlib

    raw = "reset-token-value"
    token_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=now + timedelta(minutes=30),
        )
    )
    db.commit()

    sent: list[str] = []

    class StubEmailNotificationService:
        def __init__(self, db: Session) -> None:
            self._db = db

        def trigger_event(self, *, event_code: str, payload: dict[str, object]) -> SimpleNamespace:
            sent.append(event_code)
            return SimpleNamespace(status="sent", error=None)

    monkeypatch.setattr(
        "modules.platform.auth.service.EmailNotificationService",
        StubEmailNotificationService,
    )
    monkeypatch.setattr("modules.platform.auth.service.validate_password", lambda _p: None)
    monkeypatch.setattr("modules.platform.auth.service.hash_password", lambda _p: "hashed")

    with pytest.raises(ValueError, match="Invalid or expired token"):
        AuthService(db).reset_password(token=raw, new_password="NewPassword1!")

    assert sent == []
    row = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == token_hash))
    assert row is not None
    assert row.used_at is not None


def test_refresh_rejects_inactive_user(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime.now(timezone.utc)
    user = User(
        full_name="Inactive",
        username="inactive.refresh",
        email="refresh-inactive@example.com",
        phone="9876543214",
        hashed_password="x",
        password_changed_at=now,
        is_active=False,
        is_superuser=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    jti = "22222222-2222-2222-2222-222222222222"
    db.add(
        UserSession(
            user_id=user.id,
            refresh_jti=jti,
            expires_at=now + timedelta(days=7),
            last_activity_at=now,
        )
    )
    db.commit()

    monkeypatch.setattr(
        "modules.platform.auth.service.decode_refresh_token",
        lambda _t: {"jti": jti, "sub": str(user.id)},
    )
    monkeypatch.setattr(
        "modules.platform.auth.service.assert_refresh_session_active",
        lambda *_a, **_k: None,
    )

    with pytest.raises(InvalidRefreshTokenError):
        AuthService(db).refresh("any-refresh-token")

    session = db.scalar(select(UserSession).where(UserSession.refresh_jti == jti))
    assert session is not None
    assert session.revoked_at is not None
