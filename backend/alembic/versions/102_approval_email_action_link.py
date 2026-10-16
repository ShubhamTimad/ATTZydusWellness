"""Point stock approval emails at the record page with a shared CTA.

Revision ID: 102
Revises: 101
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "102"
down_revision: str | None = "101"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_BTN = (
    '<a href="{{action_link}}" '
    'style="display:inline-block;padding:10px 18px;background:#d71920;color:#ffffff;'
    'text-decoration:none;border-radius:6px;font-weight:600;">'
)

_FALLBACK = """
<p>If the button does not work, copy and paste this URL into your browser:</p>
<p><a href="{{action_link}}">{{action_link}}</a></p>
""".strip()


def _cta(label: str) -> str:
    return f"<p>\n  {_BTN}{label}</a>\n</p>\n{_FALLBACK}"


NEW_ASSIGNED = f"""
<p>Hello {{{{user_name}}}},</p>
<p>A request needs your approval.</p>
<p><strong>{{{{entity_label}}}}:</strong> {{{{entity_name}}}}</p>
{_cta("Review request")}
""".strip()

NEW_APPROVED = f"""
<p>Hello {{{{user_name}}}},</p>
<p>Your request has been approved.</p>
<p><strong>{{{{entity_label}}}}:</strong> {{{{entity_name}}}}</p>
{_cta("View record")}
""".strip()

NEW_REJECTED = f"""
<p>Hello {{{{user_name}}}},</p>
<p>Your request was rejected.</p>
<p><strong>{{{{entity_label}}}}:</strong> {{{{entity_name}}}}</p>
<p><strong>Reason:</strong> {{{{rejection_reason}}}}</p>
{_cta("View record")}
""".strip()

NEW_REWORK = f"""
<p>Hello {{{{user_name}}}},</p>
<p>Your request requires rework.</p>
<p><strong>{{{{entity_label}}}}:</strong> {{{{entity_name}}}}</p>
<p><strong>Reason:</strong> {{{{rejection_reason}}}}</p>
{_cta("Open record")}
""".strip()

NEW_RESUBMITTED = f"""
<p>Hello {{{{user_name}}}},</p>
<p>The request has been resubmitted for approval.</p>
<p><strong>{{{{entity_label}}}}:</strong> {{{{entity_name}}}}</p>
{_cta("Review request")}
""".strip()

OLD_ASSIGNED_023 = """
<p>Hello {{user_name}},</p>
<p>A new task has been assigned to you.</p>
<p><strong>{{task_name}}</strong></p>
<p>Entity: {{entity_name}}</p>
""".strip()

OLD_ASSIGNED_043 = """
<p>Hello {{user_name}},</p>
<p>A new approval task has been assigned to your role.</p>
<p><strong>{{task_name}}</strong></p>
<p>Entity: {{entity_name}}</p>
<p><a href="{{task_link}}">Open task</a></p>
""".strip()

OLD_APPROVED = """
<p>Hello {{user_name}},</p>
<p>Your task was approved.</p>
<p><strong>{{task_name}}</strong></p>
<p>Entity: {{entity_name}}</p>
""".strip()

OLD_REJECTED = """
<p>Hello {{user_name}},</p>
<p>Your task was rejected.</p>
<p><strong>{{task_name}}</strong></p>
<p>Entity: {{entity_name}}</p>
""".strip()

OLD_REWORK = """
<p>Hello {{user_name}},</p>
<p>Your request requires rework.</p>
<p><strong>Reason:</strong> {{rejection_reason}}</p>
<p><a href="{{task_link}}">Open task</a></p>
""".strip()

OLD_RESUBMITTED = """
<p>Hello {{user_name}},</p>
<p>The request has been resubmitted for approval.</p>
<p><a href="{{task_link}}">Open request</a></p>
""".strip()

# (event_code, old_name, new_name, new_subject, old_subjects, new_body, old_bodies)
_SPECS: list[tuple[str, str, str, str, tuple[str, ...], str, tuple[str, ...]]] = [
    (
        "TASK_ASSIGNED",
        "Task assigned",
        "Approval requested",
        "Approval requested: {{entity_name}}",
        ("New task assigned: {{task_name}}",),
        NEW_ASSIGNED,
        (OLD_ASSIGNED_023, OLD_ASSIGNED_043),
    ),
    (
        "TASK_APPROVED",
        "Task approved",
        "Approval approved",
        "Request approved: {{entity_name}}",
        ("Task approved: {{task_name}}",),
        NEW_APPROVED,
        (OLD_APPROVED,),
    ),
    (
        "TASK_REJECTED",
        "Task rejected",
        "Approval rejected",
        "Request rejected: {{entity_name}}",
        ("Task rejected: {{task_name}}",),
        NEW_REJECTED,
        (OLD_REJECTED,),
    ),
    (
        "TASK_REWORK_REQUIRED",
        "Task rework required",
        "Approval rework required",
        "Rework required: {{entity_name}}",
        ("Rework required: {{entity_name}}",),
        NEW_REWORK,
        (OLD_REWORK,),
    ),
    (
        "TASK_RESUBMITTED",
        "Task resubmitted",
        "Approval resubmitted",
        "Resubmitted: {{entity_name}}",
        ("Resubmitted: {{entity_name}}",),
        NEW_RESUBMITTED,
        (OLD_RESUBMITTED,),
    ),
]


def _refresh(
    *,
    event_code: str,
    old_name: str,
    new_name: str,
    new_subject: str,
    old_subjects: tuple[str, ...],
    new_body: str,
    old_bodies: tuple[str, ...],
) -> None:
    conn = op.get_bind()
    row = conn.execute(
        sa.text(
            """
            SELECT id, subject, body_html
              FROM email_templates
             WHERE event_code = :event_code
               AND name = :old_name
             LIMIT 1
            """
        ),
        {"event_code": event_code, "old_name": old_name},
    ).mappings().first()
    if row is None:
        return
    subject = new_subject if row["subject"] in old_subjects else row["subject"]
    body = new_body if row["body_html"] in old_bodies else row["body_html"]
    conn.execute(
        sa.text(
            """
            UPDATE email_templates
               SET name = :new_name,
                   subject = :subject,
                   body_html = :body_html,
                   updated_at = CURRENT_TIMESTAMP
             WHERE id = :id
            """
        ),
        {
            "new_name": new_name,
            "subject": subject,
            "body_html": body,
            "id": int(row["id"]),
        },
    )


def upgrade() -> None:
    for spec in _SPECS:
        _refresh(
            event_code=spec[0],
            old_name=spec[1],
            new_name=spec[2],
            new_subject=spec[3],
            old_subjects=spec[4],
            new_body=spec[5],
            old_bodies=spec[6],
        )


def downgrade() -> None:
    revert = [
        (
            "TASK_ASSIGNED",
            "Approval requested",
            "Task assigned",
            "New task assigned: {{task_name}}",
            NEW_ASSIGNED,
            OLD_ASSIGNED_043,
        ),
        (
            "TASK_APPROVED",
            "Approval approved",
            "Task approved",
            "Task approved: {{task_name}}",
            NEW_APPROVED,
            OLD_APPROVED,
        ),
        (
            "TASK_REJECTED",
            "Approval rejected",
            "Task rejected",
            "Task rejected: {{task_name}}",
            NEW_REJECTED,
            OLD_REJECTED,
        ),
        (
            "TASK_REWORK_REQUIRED",
            "Approval rework required",
            "Task rework required",
            "Rework required: {{entity_name}}",
            NEW_REWORK,
            OLD_REWORK,
        ),
        (
            "TASK_RESUBMITTED",
            "Approval resubmitted",
            "Task resubmitted",
            "Resubmitted: {{entity_name}}",
            NEW_RESUBMITTED,
            OLD_RESUBMITTED,
        ),
    ]
    for event_code, new_name, old_name, old_subject, new_body, old_body in revert:
        op.execute(
            sa.text(
                """
                UPDATE email_templates
                   SET name = :old_name,
                       subject = :old_subject,
                       body_html = :old_body,
                       updated_at = CURRENT_TIMESTAMP
                 WHERE event_code = :event_code
                   AND name = :new_name
                   AND body_html = :new_body
                """
            ).bindparams(
                event_code=event_code,
                new_name=new_name,
                old_name=old_name,
                old_subject=old_subject,
                old_body=old_body,
                new_body=new_body,
            )
        )
