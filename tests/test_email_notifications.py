from __future__ import annotations

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from db.base import Base
from modules.platform.emails.model import EmailLog, EmailTemplate, EmailTemplateMapping
from modules.platform.mfa.model import UserMfa  # noqa: F401  registers User.mfa_record
from modules.platform.emails.service import EmailNotificationService


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


def test_trigger_event_skips_when_no_mapping(db: Session) -> None:
    template = EmailTemplate(
        name="Forgot password v1",
        event_code="FORGOT_PASSWORD",
        subject="Reset your password",
        body_html="<p>Hello {{user_name}}</p><p><a href='{{reset_link}}'>Reset</a></p>",
        body_text=None,
        is_active=True,
    )
    db.add(template)
    db.commit()

    sender = StubSender()
    result = EmailNotificationService(db, sender=sender).trigger_event(
        event_code="FORGOT_PASSWORD",
        payload={
            "user_name": "Alice",
            "email": "alice@example.com",
            "reset_link": "https://example.com/reset?t=1",
        },
    )

    assert result.status == "skipped"
    assert sender.calls == []


def test_trigger_event_prefers_explicit_mapping_when_present(db: Session) -> None:
    fallback_template = EmailTemplate(
        name="Forgot password fallback",
        event_code="FORGOT_PASSWORD",
        subject="Fallback subject",
        body_html="<p>Fallback {{user_name}}</p>",
        body_text=None,
        is_active=True,
    )
    mapped_template = EmailTemplate(
        name="Forgot password mapped",
        event_code="FORGOT_PASSWORD",
        subject="Mapped subject",
        body_html="<p>Mapped {{user_name}}</p>",
        body_text=None,
        is_active=True,
    )
    db.add_all([fallback_template, mapped_template])
    db.commit()
    db.refresh(mapped_template)
    db.add(
        EmailTemplateMapping(
            event_code="FORGOT_PASSWORD",
            template_id=mapped_template.id,
            is_enabled=True,
        )
    )
    db.commit()

    sender = StubSender()
    result = EmailNotificationService(db, sender=sender).trigger_event(
        event_code="FORGOT_PASSWORD",
        payload={
            "user_name": "Alice",
            "email": "alice@example.com",
            "reset_link": "https://example.com/reset?t=1",
        },
    )

    assert result.status == "sent"
    assert sender.calls[0]["subject"] == "Mapped subject"
    assert "Mapped Alice" in sender.calls[0]["body"]
