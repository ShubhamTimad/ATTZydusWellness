"""Create capitalization_form_audit table.

Revision ID: 062
Revises: 061
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "062"
down_revision = "061"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "capitalization_form_audit",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("form_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("old_value", sa.JSON(), nullable=True),
        sa.Column("new_value", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["form_id"], ["capitalization_forms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_capitalization_form_audit_form_id",
        "capitalization_form_audit",
        ["form_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_capitalization_form_audit_form_id", table_name="capitalization_form_audit")
    op.drop_table("capitalization_form_audit")
