"""Multiple approver roles on one workflow level."""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "100"
down_revision: str | None = "099"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "approval_step_roles",
        sa.Column("step_id", sa.Integer(), nullable=False),
        sa.Column("role_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["step_id"], ["approval_steps.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("step_id", "role_id"),
    )
    op.execute(
        sa.text(
            "INSERT INTO approval_step_roles (step_id, role_id) "
            "SELECT id, approver_role_id FROM approval_steps"
        )
    )


def downgrade() -> None:
    op.drop_table("approval_step_roles")
