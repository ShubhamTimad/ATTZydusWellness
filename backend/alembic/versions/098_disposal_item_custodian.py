"""Per-asset custodian on disposal line items.

Revision ID: 098
Revises: 097
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "098"
down_revision: str | None = "097"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "asset_disposal_order_items",
        sa.Column(
            "to_asset_custodian_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # Existing orders had one custodian for every asset; keep them pointing at it.
    op.execute(
        """
        UPDATE asset_disposal_order_items AS i
        SET to_asset_custodian_id = o.receiver_user_id
        FROM asset_disposal_orders AS o
        WHERE i.order_id = o.id
          AND o.receiver_user_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_column("asset_disposal_order_items", "to_asset_custodian_id")
