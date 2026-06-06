"""Add assigned/closed workflow fields for physical orders."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "042"
down_revision = "041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "physical_orders",
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        """
        UPDATE physical_orders
        SET status = 'assigned'
        WHERE status = 'approved' AND started_at IS NULL
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE physical_orders
        SET status = 'approved'
        WHERE status = 'assigned' AND started_at IS NULL
        """
    )
    op.drop_column("physical_orders", "closed_at")
