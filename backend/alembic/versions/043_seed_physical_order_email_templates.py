"""Seed physical order email templates and refresh task-assigned template.

Revision ID: 043
Revises: 042
Create Date: 2026-06-05
"""

from __future__ import annotations

from collections.abc import Sequence
import os

import sqlalchemy as sa
from alembic import op

revision: str = "043"
down_revision: str | None = "042"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _should_seed_templates() -> bool:
    raw = os.getenv("SEED_SYSTEM_EMAIL_TEMPLATES")
    if raw is None:
        return True
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _seed_template(*, name: str, event_code: str, subject: str, body_html: str) -> None:
    op.execute(
        sa.text(
            """
            INSERT INTO email_templates (name, event_code, subject, body_html, body_text, is_active, created_at, updated_at)
            SELECT :name, :event_code, :subject, :body_html, NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE name = :name)
            """
        ).bindparams(
            name=name,
            event_code=event_code,
            subject=subject,
            body_html=body_html,
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO email_template_mappings (event_code, template_id, is_enabled, created_at, updated_at)
            SELECT :event_code, t.id, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            FROM email_templates t
            WHERE t.name = :name
              AND NOT EXISTS (SELECT 1 FROM email_template_mappings m WHERE m.event_code = :event_code)
            """
        ).bindparams(name=name, event_code=event_code)
    )


def upgrade() -> None:
    if not _should_seed_templates():
        return

    op.execute(
        sa.text(
            """
            UPDATE email_templates
            SET subject = 'New task assigned: {{task_name}}',
                body_html = :body_html,
                updated_at = CURRENT_TIMESTAMP
            WHERE name = 'Task assigned'
            """
        ).bindparams(
            body_html="""
<p>Hello {{user_name}},</p>
<p>A new approval task has been assigned to your role.</p>
<p><strong>{{task_name}}</strong></p>
<p>Entity: {{entity_name}}</p>
<p><a href="{{task_link}}">Open task</a></p>
""".strip(),
        )
    )

    _seed_template(
        name="Physical order assigned",
        event_code="ORDER_ASSIGNED",
        subject="Physical order assigned: {{order_number}}",
        body_html="""
<p>Hello {{user_name}},</p>
<p>A physical verification order has been assigned to you.</p>
<p><strong>Order:</strong> {{order_number}}</p>
<p><a href="{{order_link}}">Open order</a></p>
""".strip(),
    )
    _seed_template(
        name="Physical order rejected",
        event_code="ORDER_REJECTED",
        subject="Physical order rejected: {{order_number}}",
        body_html="""
<p>Hello {{user_name}},</p>
<p>Your physical verification order was rejected.</p>
<p><strong>Order:</strong> {{order_number}}</p>
<p><strong>Reason:</strong> {{reason}}</p>
<p><a href="{{order_link}}">View order</a></p>
""".strip(),
    )
    _seed_template(
        name="Physical order completed",
        event_code="ORDER_COMPLETED",
        subject="Physical order completed: {{order_number}}",
        body_html="""
<p>Hello {{user_name}},</p>
<p>The physical verification order has been completed.</p>
<p><strong>Order:</strong> {{order_number}}</p>
<p><a href="{{order_link}}">View order</a></p>
""".strip(),
    )
    _seed_template(
        name="Physical order returned for execution",
        event_code="ORDER_RETURNED_FOR_EXECUTION",
        subject="Order returned for re-work: {{order_number}}",
        body_html="""
<p>Hello {{user_name}},</p>
<p>Closure approval was rejected. Please re-verify the rejected assets and submit again.</p>
<p><strong>Order:</strong> {{order_number}}</p>
<p><strong>Reason:</strong> {{reason}}</p>
<p><a href="{{order_link}}">Open order</a></p>
""".strip(),
    )


def downgrade() -> None:
    for name in (
        "Physical order assigned",
        "Physical order rejected",
        "Physical order completed",
        "Physical order returned for execution",
    ):
        op.execute(sa.text("DELETE FROM email_templates WHERE name = :name").bindparams(name=name))
