"""Transfer order destination asset custodian."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "072"
down_revision = "071"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "asset_transfer_orders",
        sa.Column(
            "to_asset_custodian_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_asset_transfer_orders_to_asset_custodian_id",
        "asset_transfer_orders",
        ["to_asset_custodian_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_asset_transfer_orders_to_asset_custodian_id",
        table_name="asset_transfer_orders",
    )
    op.drop_column("asset_transfer_orders", "to_asset_custodian_id")
