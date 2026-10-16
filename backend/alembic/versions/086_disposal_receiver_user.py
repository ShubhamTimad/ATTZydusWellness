"""Persist disposal receiver so CF reject can return the order for re-receive."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "086"
down_revision = "085"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "asset_disposal_orders",
        sa.Column(
            "receiver_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_asset_disposal_orders_receiver_user_id",
        "asset_disposal_orders",
        ["receiver_user_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_asset_disposal_orders_receiver_user_id",
        table_name="asset_disposal_orders",
    )
    op.drop_column("asset_disposal_orders", "receiver_user_id")
