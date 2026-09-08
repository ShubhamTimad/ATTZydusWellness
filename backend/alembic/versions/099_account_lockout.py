"""Failed-login lockout, unlock permission, and lock/unlock emails.

Revision ID: 099
Revises: 098
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "099"
down_revision: str | None = "098"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


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
    op.add_column(
        "users",
        sa.Column("failed_login_attempts", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("users", sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True))

    op.execute(
        sa.text(
            """
            INSERT INTO permissions (feature_id, action, code, description, created_at)
            SELECT f.id, 'unlock', 'users.unlock', 'Unlock an account locked after failed login attempts', CURRENT_TIMESTAMP
            FROM features f
            WHERE f.key = 'users'
              AND NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'users.unlock')
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT rp.role_id, unlock_perm.id
            FROM role_permissions rp
            JOIN permissions existing ON existing.id = rp.permission_id AND existing.code = 'users.update'
            JOIN permissions unlock_perm ON unlock_perm.code = 'users.unlock'
            WHERE NOT EXISTS (
                SELECT 1 FROM role_permissions have
                WHERE have.role_id = rp.role_id AND have.permission_id = unlock_perm.id
            )
            """
        )
    )

    _seed_template(
        name="Account locked",
        event_code="ACCOUNT_LOCKED",
        subject="Your account has been locked",
        body_html="""
<p>Hello {{user_name}},</p>
<p>Your account has been locked because of multiple failed login attempts.</p>
<p>Please reach out to an administrator to unlock your account.</p>
""".strip(),
    )
    _seed_template(
        name="Account unlocked",
        event_code="ACCOUNT_UNLOCKED",
        subject="Your account has been unlocked",
        body_html="""
<p>Hello {{user_name}},</p>
<p>Your account has been unlocked.</p>
<p><strong>Temporary password:</strong> {{temp_password}}</p>
<p>Use the link below to set a new password:</p>
<p><a href="{{reset_link}}">{{reset_link}}</a></p>
<p>Please change this temporary password after you sign in.</p>
""".strip(),
    )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM email_template_mappings WHERE event_code IN ('ACCOUNT_LOCKED', 'ACCOUNT_UNLOCKED')"))
    op.execute(sa.text("DELETE FROM email_templates WHERE event_code IN ('ACCOUNT_LOCKED', 'ACCOUNT_UNLOCKED')"))
    op.execute(sa.text("DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code = 'users.unlock')"))
    op.execute(sa.text("DELETE FROM permissions WHERE code = 'users.unlock'"))
    op.drop_column("users", "locked_at")
    op.drop_column("users", "failed_login_attempts")
