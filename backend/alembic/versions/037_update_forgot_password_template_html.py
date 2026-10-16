"""Refresh the stock forgot-password email template.

Revision ID: 037
Revises: 036
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "037"
down_revision = "036"
branch_labels = None
depends_on = None


OLD_BODY = """
<p>Hello {{user_name}},</p>
<p>We received a request to reset your password.</p>
<p><a href="{{reset_link}}">Click here to reset your password</a></p>
<p>If you didn’t request this, you can ignore this email.</p>
""".strip()

NEW_BODY = """
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
""".strip()


def upgrade() -> None:
    # Only refresh the untouched stock template so admin customizations are preserved.
    op.execute(
        sa.text(
            """
            UPDATE email_templates
               SET body_html = :new_body,
                   updated_at = CURRENT_TIMESTAMP
             WHERE event_code = 'FORGOT_PASSWORD'
               AND name = 'Forgot password (reset link)'
               AND body_html = :old_body
            """
        ).bindparams(new_body=NEW_BODY, old_body=OLD_BODY)
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE email_templates
               SET body_html = :old_body,
                   updated_at = CURRENT_TIMESTAMP
             WHERE event_code = 'FORGOT_PASSWORD'
               AND name = 'Forgot password (reset link)'
               AND body_html = :new_body
            """
        ).bindparams(new_body=NEW_BODY, old_body=OLD_BODY)
    )
