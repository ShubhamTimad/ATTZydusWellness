"""Physical verification orders."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "038"
down_revision = "037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "physical_orders",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("order_number", sa.String(length=64), nullable=False),
        sa.Column("plant_id", sa.Integer(), sa.ForeignKey("org_units.id", ondelete="RESTRICT"), nullable=False),
        sa.Column(
            "cost_center_id",
            sa.Integer(),
            sa.ForeignKey("cost_center_masters.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assigned_to", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assigned_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="draft"),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column(
            "approval_request_id",
            sa.Integer(),
            sa.ForeignKey("approval_requests.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("order_number", name="uq_physical_orders_order_number"),
    )
    op.create_index("ix_physical_orders_status", "physical_orders", ["status"])
    op.create_index("ix_physical_orders_plant_id", "physical_orders", ["plant_id"])
    op.create_index("ix_physical_orders_assigned_to", "physical_orders", ["assigned_to"])
    op.create_index("ix_physical_orders_created_by", "physical_orders", ["created_by"])

    op.create_table(
        "physical_order_items",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "order_id",
            sa.Integer(),
            sa.ForeignKey("physical_orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "asset_id",
            sa.Integer(),
            sa.ForeignKey("asset_master.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("verification_status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("scan_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("verified_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("order_id", "asset_id", name="uq_physical_order_items_order_asset"),
    )
    op.create_index("ix_physical_order_items_order_id", "physical_order_items", ["order_id"])
    op.create_index("ix_physical_order_items_asset_id", "physical_order_items", ["asset_id"])

    op.create_table(
        "physical_order_audit",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "order_id",
            sa.Integer(),
            sa.ForeignKey("physical_orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("old_value", sa.JSON(), nullable=True),
        sa.Column("new_value", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_physical_order_audit_order_id", "physical_order_audit", ["order_id"])


def downgrade() -> None:
    op.drop_index("ix_physical_order_audit_order_id", table_name="physical_order_audit")
    op.drop_table("physical_order_audit")
    op.drop_index("ix_physical_order_items_asset_id", table_name="physical_order_items")
    op.drop_index("ix_physical_order_items_order_id", table_name="physical_order_items")
    op.drop_table("physical_order_items")
    op.drop_index("ix_physical_orders_created_by", table_name="physical_orders")
    op.drop_index("ix_physical_orders_assigned_to", table_name="physical_orders")
    op.drop_index("ix_physical_orders_plant_id", table_name="physical_orders")
    op.drop_index("ix_physical_orders_status", table_name="physical_orders")
    op.drop_table("physical_orders")
