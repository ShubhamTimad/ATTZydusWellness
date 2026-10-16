"""Add is_scrapyard on cost centers; to_cost_center_id on disposal orders."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "088"
down_revision = "087"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "cost_center_masters",
        sa.Column(
            "is_scrapyard",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "asset_disposal_orders",
        sa.Column("to_cost_center_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_asset_disposal_orders_to_cost_center_id",
        "asset_disposal_orders",
        "cost_center_masters",
        ["to_cost_center_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_asset_disposal_orders_to_cost_center_id",
        "asset_disposal_orders",
        ["to_cost_center_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_asset_disposal_orders_to_cost_center_id",
        table_name="asset_disposal_orders",
    )
    op.drop_constraint(
        "fk_asset_disposal_orders_to_cost_center_id",
        "asset_disposal_orders",
        type_="foreignkey",
    )
    op.drop_column("asset_disposal_orders", "to_cost_center_id")
    op.drop_column("cost_center_masters", "is_scrapyard")
