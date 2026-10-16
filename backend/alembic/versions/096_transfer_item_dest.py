"""Per-asset destination custodian and locations on transfer line items.

Revision ID: 096
Revises: 095
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "096"
down_revision: str | None = "095"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "asset_transfer_order_items",
        sa.Column(
            "to_asset_custodian_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "asset_transfer_order_items",
        sa.Column("to_functional_location", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "asset_transfer_order_items",
        sa.Column("to_actual_location", sa.String(length=255), nullable=True),
    )
    op.execute(
        """
        UPDATE asset_transfer_order_items AS i
        SET
            to_asset_custodian_id = o.to_asset_custodian_id,
            to_functional_location = o.to_functional_location,
            to_actual_location = o.to_actual_location
        FROM asset_transfer_orders AS o
        WHERE i.order_id = o.id
        """
    )


def downgrade() -> None:
    op.drop_column("asset_transfer_order_items", "to_actual_location")
    op.drop_column("asset_transfer_order_items", "to_functional_location")
    op.drop_column("asset_transfer_order_items", "to_asset_custodian_id")
