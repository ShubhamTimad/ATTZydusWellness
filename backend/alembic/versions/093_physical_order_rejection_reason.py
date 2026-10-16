"""Store physical-order rejection reason on the order, not each item.

Revision ID: 093
Revises: 092
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "093"
down_revision: str | None = "092"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "physical_orders",
        sa.Column("rejection_reason", sa.Text(), nullable=True),
    )
    # One reason per order: copy from any rejected line that still has text.
    op.execute(
        """
        UPDATE physical_orders AS o
        SET rejection_reason = (
            SELECT i.rejection_reason
            FROM physical_order_items AS i
            WHERE i.order_id = o.id
              AND i.rejection_reason IS NOT NULL
              AND TRIM(i.rejection_reason) <> ''
            ORDER BY i.id
            LIMIT 1
        )
        WHERE o.status = 'rejected'
          AND o.rejection_reason IS NULL
        """
    )
    op.execute(
        """
        UPDATE physical_order_items
        SET rejection_reason = NULL
        WHERE rejection_reason IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_column("physical_orders", "rejection_reason")
