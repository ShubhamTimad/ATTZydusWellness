#!/usr/bin/env python3
"""Ensure core email templates and event mappings exist (idempotent).

Use on servers where migrations ran with SEED_SYSTEM_EMAIL_TEMPLATES=false, or after
a fresh deploy before SMTP is configured in Admin → Settings.

Run from project root::

    ./venv/bin/python scripts/ensure_system_email_templates.py

Inside Docker backend container::

    docker compose --env-file .env.docker exec backend \\
      python /app/scripts/ensure_system_email_templates.py
"""

from __future__ import annotations

import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from sqlalchemy import select

import db.models  # noqa: F401
from db.session import SessionLocal
from modules.platform.emails.model import EmailTemplate, EmailTemplateMapping

CORE_TEMPLATES: list[dict[str, str]] = [
    {
        "name": "User created (basic)",
        "event_code": "USER_CREATED",
        "subject": "Welcome, {{user_name}}",
        "body_html": """
<p>Hello {{user_name}},</p>
<p>Your account has been created and is now active.</p>
<p>You can sign in with your registered email: <strong>{{email}}</strong>.</p>
""".strip(),
    },
    {
        "name": "Forgot password (reset link)",
        "event_code": "FORGOT_PASSWORD",
        "subject": "Reset your password",
        "body_html": """
<p>Hello {{user_name}},</p>
<p>We received a request to reset your password for {{company_name}}.</p>
<p>Click the button below to choose a new password:</p>
<p>
  <a
    href="{{reset_link}}"
    style="display:inline-block;padding:10px 18px;background:#d71920;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;"
  >
    Reset Password
  </a>
</p>
<p>This link expires in {{expiry_minutes}} minutes.</p>
<p>If the button does not work, copy and paste this URL into your browser:</p>
<p><a href="{{reset_link}}">{{reset_link}}</a></p>
<p>If you did not request this, you can safely ignore this email.</p>
<p>Regards,<br>{{company_name}}</p>
""".strip(),
    },
    {
        "name": "Password reset (confirmation)",
        "event_code": "PASSWORD_RESET",
        "subject": "Your password was changed",
        "body_html": """
<p>Hello {{user_name}},</p>
<p>Your password has been updated successfully.</p>
<p>If you did not make this change, please contact your administrator immediately.</p>
""".strip(),
    },
]


def ensure_templates(db) -> None:
    for spec in CORE_TEMPLATES:
        name = spec["name"]
        event_code = spec["event_code"]
        tpl = db.scalar(select(EmailTemplate).where(EmailTemplate.name == name))
        if tpl is None:
            tpl = EmailTemplate(
                name=name,
                event_code=event_code,
                subject=spec["subject"],
                body_html=spec["body_html"],
                body_text=None,
                is_active=True,
            )
            db.add(tpl)
            db.flush()
            print(f"  created template: {name}")
        elif not tpl.is_active:
            tpl.is_active = True
            print(f"  reactivated template: {name}")

        mapping = db.scalar(
            select(EmailTemplateMapping).where(EmailTemplateMapping.event_code == event_code)
        )
        if mapping is None:
            db.add(
                EmailTemplateMapping(
                    event_code=event_code,
                    template_id=int(tpl.id),
                    is_enabled=True,
                )
            )
            print(f"  created mapping: {event_code} -> template #{tpl.id}")
        elif not mapping.is_enabled:
            mapping.is_enabled = True
            print(f"  enabled mapping: {event_code}")
        elif int(mapping.template_id) != int(tpl.id):
            mapping.template_id = int(tpl.id)
            print(f"  relinked mapping: {event_code} -> template #{tpl.id}")


def main() -> None:
    db = SessionLocal()
    try:
        print("Ensuring system email templates and mappings…")
        ensure_templates(db)
        db.commit()
        print("Done.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
