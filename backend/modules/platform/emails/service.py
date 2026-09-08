from __future__ import annotations

import re
import threading
from dataclasses import dataclass
from typing import Any

from jinja2 import Environment, StrictUndefined, TemplateError
from sqlalchemy import select
from sqlalchemy.orm import Session

from modules.platform.emails.constants import EVENT_CODES
from modules.platform.emails.model import EmailLog, EmailTemplate, EmailTemplateMapping
from modules.platform.emails.smtp_transport import send_via_smtp
from modules.platform.settings.smtp_config import SmtpConfig, get_smtp_config, is_email_delivery_enabled
from modules.platform.users.model import User


_VAR_RE = re.compile(r"{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}")


def extract_variables(content: str) -> list[str]:
    if not content:
        return []
    return sorted({m.group(1) for m in _VAR_RE.finditer(content)})


def _missing_vars(required: list[str], payload: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    for k in required:
        if k not in payload:
            missing.append(k)
    return missing


_env = Environment(autoescape=True, undefined=StrictUndefined)


def render_template(content: str, payload: dict[str, Any]) -> str:
    tmpl = _env.from_string(content)
    return tmpl.render(**(payload or {}))


@dataclass(frozen=True)
class TriggerResult:
    status: str  # sent|failed|skipped
    missing_variables: list[str]
    error: str | None = None


class EmailSender:
    """Send via SMTP when delivery is enabled in Settings; otherwise log to console (dev)."""

    def send_email(
        self,
        *,
        to_email: str,
        subject: str,
        body: str,
        cfg: SmtpConfig | None = None,
    ) -> None:
        if cfg is None:
            if not is_email_delivery_enabled():
                print(f"[email-engine] (delivery disabled) to={to_email} subject={subject!r}\n{body}\n")
                return

            cfg = get_smtp_config()
            if cfg is None:
                print(
                    f"[email-engine] (SMTP not configured) to={to_email} subject={subject!r}\n{body}\n"
                )
                return

        send_via_smtp(cfg, to_email=to_email, subject=subject, body=body)


def enqueue_trigger_events(events: list[tuple[str, dict[str, Any]]]) -> None:
    """Send emails off the request thread so SMTP timeouts do not hold the action."""
    copied = [(code, dict(payload)) for code, payload in events if code and payload]
    if not copied:
        return

    def _send() -> None:
        from db.session import SessionLocal

        db = SessionLocal()
        try:
            svc = EmailNotificationService(db)
            for code, payload in copied:
                try:
                    svc.trigger_event(event_code=code, payload=payload)
                except Exception:
                    pass
        finally:
            db.close()

    threading.Thread(target=_send, name="email-event", daemon=True).start()


class EmailNotificationService:
    def __init__(self, db: Session, *, sender: EmailSender | None = None) -> None:
        self._db = db
        self._sender = sender or EmailSender()

    def trigger_event(self, *, event_code: str, payload: dict[str, Any]) -> TriggerResult:
        code = (event_code or "").strip().upper()
        if code not in EVENT_CODES:
            return self._log(code, payload, status="failed", subject="", body="", error_message="Unknown event_code")

        mapping = self._db.scalar(select(EmailTemplateMapping).where(EmailTemplateMapping.event_code == code))
        if mapping is None or not bool(mapping.is_enabled):
            return TriggerResult(status="skipped", missing_variables=[], error=None)

        template = self._db.get(EmailTemplate, int(mapping.template_id))
        if template is None or not bool(template.is_active):
            return TriggerResult(status="skipped", missing_variables=[], error=None)

        required = sorted(set(extract_variables(template.subject) + extract_variables(template.body_html)))
        missing = _missing_vars(required, payload or {})
        if missing:
            return self._log(
                code,
                payload,
                status="failed",
                subject=template.subject,
                body=template.body_html,
                error_message=f"Missing variables: {', '.join(missing)}",
                missing_variables=missing,
            )

        try:
            rendered_subject = render_template(template.subject, payload)
            rendered_body = render_template(template.body_html, payload)
        except TemplateError as exc:
            return self._log(
                code,
                payload,
                status="failed",
                subject=template.subject,
                body=template.body_html,
                error_message=f"Template render error: {exc}",
            )

        to_email = str(payload.get("email") or payload.get("to_email") or "").strip()
        if not to_email:
            return self._log(
                code,
                payload,
                status="failed",
                subject=rendered_subject,
                body=rendered_body,
                error_message="Missing recipient email (payload.email or payload.to_email)",
            )

        # Shared inactivity guard: never mail known deactivated accounts.
        recipient = self._db.scalar(select(User).where(User.email == to_email.lower()))
        if recipient is not None and not bool(recipient.is_active):
            return self._log(
                code,
                payload,
                status="skipped",
                subject=rendered_subject,
                body=rendered_body,
                error_message="Recipient account is inactive",
            )

        try:
            self._sender.send_email(to_email=to_email, subject=rendered_subject, body=rendered_body)
            return self._log(code, payload, status="sent", subject=rendered_subject, body=rendered_body, error_message=None)
        except Exception as exc:  # pragma: no cover
            return self._log(
                code,
                payload,
                status="failed",
                subject=rendered_subject,
                body=rendered_body,
                error_message=str(exc),
            )

    def _log(
        self,
        event_code: str,
        payload: dict[str, Any],
        *,
        status: str,
        subject: str,
        body: str,
        error_message: str | None,
        missing_variables: list[str] | None = None,
    ) -> TriggerResult:
        to_email = str(payload.get("email") or payload.get("to_email") or "").strip() or "—"
        # Write email logs on a separate session so we never commit the caller's unit of work.
        from db.session import SessionLocal

        log_db = SessionLocal()
        try:
            log_db.add(
                EmailLog(
                    event_code=event_code,
                    to_email=to_email,
                    subject=subject or "",
                    body=body or "",
                    status=status,
                    error_message=error_message,
                )
            )
            log_db.commit()
        except Exception:
            log_db.rollback()
        finally:
            log_db.close()
        return TriggerResult(status=status, missing_variables=missing_variables or [], error=error_message)

