"""Normalize legacy disposal in_rework status to rejected."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "083"
down_revision = "082"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE asset_disposal_orders
            SET status = 'rejected'
            WHERE status = 'in_rework'
            """
        )
    )


def downgrade() -> None:
    # Irreversible: cannot distinguish which rejected rows were formerly in_rework.
    pass
