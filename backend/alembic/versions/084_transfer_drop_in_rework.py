"""Normalize legacy transfer in_rework status to rejected."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "084"
down_revision = "083"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE asset_transfer_orders
            SET status = 'rejected'
            WHERE status = 'in_rework'
            """
        )
    )


def downgrade() -> None:
    # Irreversible: cannot distinguish which rejected rows were formerly in_rework.
    pass
