"""Per-asset scrapyard locations on disposal line items.

Revision ID: 097
Revises: 096
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "097"
down_revision: str | None = "096"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "asset_disposal_order_items",
        sa.Column("to_functional_location", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "asset_disposal_order_items",
        sa.Column("to_actual_location", sa.String(length=255), nullable=True),
    )
    # Already-received orders kept their locations only on the assets; copy them onto the
    # line items so the detail page shows per-asset values instead of falling back.
    op.execute(
        """
        UPDATE asset_disposal_order_items AS i
        SET
            to_functional_location = l.functional_location,
            to_actual_location = l.actual_location
        FROM asset_disposal_orders AS o, asset_location_information AS l
        WHERE i.order_id = o.id
          AND l.asset_id = i.asset_id
          AND o.status IN ('pending_cf_close', 'closed')
        """
    )


def downgrade() -> None:
    op.drop_column("asset_disposal_order_items", "to_actual_location")
    op.drop_column("asset_disposal_order_items", "to_functional_location")
