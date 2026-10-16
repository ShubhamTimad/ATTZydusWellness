"""Seed capitalization approval success email for Cost Center Users.

Revision ID: 101
Revises: 100
"""

from __future__ import annotations

from collections.abc import Sequence
import os

import sqlalchemy as sa
from alembic import op

revision: str = "101"
down_revision: str | None = "100"
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
        ).bindparams(name=name, event_code=event_code, subject=subject, body_html=body_html)
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
    _seed_template(
        name="Capitalization approved",
        event_code="CAPITALIZATION_APPROVED",
        subject="Capitalization form approved: {{form_number}}",
        body_html="""
<p>Hello {{user_name}},</p>
<p>Capitalization form <strong>{{form_number}}</strong> has been approved.</p>
<p>Asset: {{asset_name}}</p>
<p>Cost Center: {{cost_center}}</p>
<p><a href="{{form_link}}">Open form</a></p>
""".strip(),
    )


def downgrade() -> None:
    op.execute(
        sa.text("DELETE FROM email_template_mappings WHERE event_code = 'CAPITALIZATION_APPROVED'")
    )
    op.execute(sa.text("DELETE FROM email_templates WHERE name = 'Capitalization approved'"))
