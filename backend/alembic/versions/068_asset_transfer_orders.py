"""Asset transfer orders."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "068"
down_revision = "067"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "asset_transfer_orders",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("order_number", sa.String(length=64), nullable=False),
        sa.Column("plant_id", sa.Integer(), sa.ForeignKey("org_units.id", ondelete="RESTRICT"), nullable=False),
        sa.Column(
            "from_cost_center_id",
            sa.Integer(),
            sa.ForeignKey("cost_center_masters.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "to_cost_center_id",
            sa.Integer(),
            sa.ForeignKey("cost_center_masters.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("to_functional_location", sa.String(length=255), nullable=True),
        sa.Column("to_actual_location", sa.String(length=255), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assigned_to", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assigned_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="draft"),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("order_number", name="uq_asset_transfer_orders_order_number"),
    )
    op.create_index("ix_asset_transfer_orders_status", "asset_transfer_orders", ["status"])
    op.create_index("ix_asset_transfer_orders_plant_id", "asset_transfer_orders", ["plant_id"])
    op.create_index("ix_asset_transfer_orders_assigned_to", "asset_transfer_orders", ["assigned_to"])
    op.create_index("ix_asset_transfer_orders_created_by", "asset_transfer_orders", ["created_by"])

    op.create_table(
        "asset_transfer_order_items",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "order_id",
            sa.Integer(),
            sa.ForeignKey("asset_transfer_orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "asset_id",
            sa.Integer(),
            sa.ForeignKey("asset_master.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("from_cost_center_code", sa.String(length=128), nullable=True),
        sa.Column("from_functional_location", sa.String(length=255), nullable=True),
        sa.Column("from_actual_location", sa.String(length=255), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("order_id", "asset_id", name="uq_asset_transfer_order_items_order_asset"),
    )
    op.create_index("ix_asset_transfer_order_items_order_id", "asset_transfer_order_items", ["order_id"])
    op.create_index("ix_asset_transfer_order_items_asset_id", "asset_transfer_order_items", ["asset_id"])

    op.create_table(
        "asset_transfer_order_audit",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "order_id",
            sa.Integer(),
            sa.ForeignKey("asset_transfer_orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("old_value", sa.JSON(), nullable=True),
        sa.Column("new_value", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_asset_transfer_order_audit_order_id", "asset_transfer_order_audit", ["order_id"])


def downgrade() -> None:
    op.drop_index("ix_asset_transfer_order_audit_order_id", table_name="asset_transfer_order_audit")
    op.drop_table("asset_transfer_order_audit")
    op.drop_index("ix_asset_transfer_order_items_asset_id", table_name="asset_transfer_order_items")
    op.drop_index("ix_asset_transfer_order_items_order_id", table_name="asset_transfer_order_items")
    op.drop_table("asset_transfer_order_items")
    op.drop_index("ix_asset_transfer_orders_created_by", table_name="asset_transfer_orders")
    op.drop_index("ix_asset_transfer_orders_assigned_to", table_name="asset_transfer_orders")
    op.drop_index("ix_asset_transfer_orders_plant_id", table_name="asset_transfer_orders")
    op.drop_index("ix_asset_transfer_orders_status", table_name="asset_transfer_orders")
    op.drop_table("asset_transfer_orders")
