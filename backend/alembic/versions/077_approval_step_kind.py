"""Add step_kind to approval_steps (approve|receive|confirm|close)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "077"
down_revision = "076"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "approval_steps",
        sa.Column(
            "step_kind",
            sa.String(length=32),
            nullable=False,
            server_default="approve",
        ),
    )


def downgrade() -> None:
    op.drop_column("approval_steps", "step_kind")
