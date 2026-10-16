"""Snapshot source asset custodian on transfer line items for reject rollback."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "074"
down_revision = "073"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "asset_transfer_order_items",
        sa.Column(
            "from_asset_custodian_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("asset_transfer_order_items", "from_asset_custodian_id")
