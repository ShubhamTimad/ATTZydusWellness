"""Add org_scope to approval_steps (source|destination|null=all role users)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "087"
down_revision = "086"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "approval_steps",
        sa.Column("org_scope", sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("approval_steps", "org_scope")
