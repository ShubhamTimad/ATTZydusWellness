"""Asset Master foundation — normalized tables (replaces legacy flat assets).

Revision ID: 030
Revises: 029
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "030"
down_revision = "029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("assets"):
        op.drop_table("assets")

    op.create_table(
        "asset_categories",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )

    op.create_table(
        "asset_import_batches",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("filename", sa.String(length=512), nullable=True),
        sa.Column("total_rows", sa.Integer(), server_default="0", nullable=False),
        sa.Column("valid_rows", sa.Integer(), server_default="0", nullable=False),
        sa.Column("error_rows", sa.Integer(), server_default="0", nullable=False),
        sa.Column("status", sa.String(length=32), server_default="draft", nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "asset_master",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("asset_name", sa.String(length=255), nullable=False),
        sa.Column("asset_code", sa.String(length=128), nullable=False),
        sa.Column("rfid_code", sa.String(length=128), nullable=True),
        sa.Column("serial_no", sa.String(length=128), nullable=True),
        sa.Column("asset_category_id", sa.Integer(), nullable=True),
        sa.Column("lifecycle_status", sa.String(length=32), server_default="draft", nullable=False),
        sa.Column("approval_status", sa.String(length=32), server_default="not_required", nullable=False),
        sa.Column("ownership_type", sa.String(length=64), nullable=True),
        sa.Column("source_type", sa.String(length=16), server_default="manual", nullable=False),
        sa.Column("import_batch_id", sa.Integer(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("approved_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["asset_category_id"], ["asset_categories.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["import_batch_id"], ["asset_import_batches.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["approved_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("asset_code"),
        sa.UniqueConstraint("rfid_code"),
    )
    op.create_index("ix_asset_master_asset_name", "asset_master", ["asset_name"])
    op.create_index("ix_asset_master_lifecycle_status", "asset_master", ["lifecycle_status"])
    op.create_index("ix_asset_master_approval_status", "asset_master", ["approval_status"])
    op.create_index("ix_asset_master_deleted_at", "asset_master", ["deleted_at"])

    op.create_table(
        "asset_information",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("asset_id", sa.Integer(), nullable=False),
        sa.Column("inventory_no", sa.String(length=128), nullable=True),
        sa.Column("asset_description", sa.Text(), nullable=True),
        sa.Column("engineering_description", sa.Text(), nullable=True),
        sa.Column("qa_description", sa.Text(), nullable=True),
        sa.Column("is_local_finance_user", sa.Boolean(), nullable=True),
        sa.Column("asset_allocation", sa.String(length=255), nullable=True),
        sa.Column("pm_equipment_id", sa.String(length=128), nullable=True),
        sa.ForeignKeyConstraint(["asset_id"], ["asset_master.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("asset_id"),
    )

    op.create_table(
        "asset_location_information",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("asset_id", sa.Integer(), nullable=False),
        sa.Column("plant_id", sa.Integer(), nullable=True),
        sa.Column("functional_location", sa.String(length=255), nullable=True),
        sa.Column("actual_location", sa.String(length=255), nullable=True),
        sa.Column("building", sa.String(length=128), nullable=True),
        sa.Column("floor", sa.String(length=64), nullable=True),
        sa.Column("room", sa.String(length=64), nullable=True),
        sa.Column("zone", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(["asset_id"], ["asset_master.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["plant_id"], ["org_units.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("asset_id"),
    )
    op.create_index("ix_asset_location_plant_id", "asset_location_information", ["plant_id"])

    op.create_table(
        "asset_financial_information",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("asset_id", sa.Integer(), nullable=False),
        sa.Column("cost_center", sa.String(length=128), nullable=True),
        sa.Column("profit_center", sa.String(length=128), nullable=True),
        sa.Column("cap_date", sa.Date(), nullable=True),
        sa.Column("gross_block", sa.Numeric(18, 2), nullable=True),
        sa.Column("vendor_name", sa.String(length=255), nullable=True),
        sa.Column("po_number", sa.String(length=128), nullable=True),
        sa.Column("currency", sa.String(length=8), nullable=True),
        sa.ForeignKeyConstraint(["asset_id"], ["asset_master.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("asset_id"),
    )
    op.create_index("ix_asset_financial_cost_center", "asset_financial_information", ["cost_center"])

    op.create_table(
        "asset_inventory_information",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("asset_id", sa.Integer(), nullable=False),
        sa.Column("inventory_count", sa.Integer(), nullable=True),
        sa.Column("physical_count", sa.Integer(), nullable=True),
        sa.Column("last_verification_date", sa.Date(), nullable=True),
        sa.Column("verification_status", sa.String(length=64), nullable=True),
        sa.Column("verification_remarks", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["asset_id"], ["asset_master.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("asset_id"),
    )

    op.create_table(
        "asset_audit_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("asset_id", sa.Integer(), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("section", sa.String(length=64), nullable=True),
        sa.Column("old_value", sa.JSON(), nullable=True),
        sa.Column("new_value", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["asset_id"], ["asset_master.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_asset_audit_asset_id", "asset_audit_events", ["asset_id"])

    # Default categories
    op.execute(
        """
        INSERT INTO asset_categories (code, name, is_active) VALUES
        ('EQUIPMENT', 'Equipment', true),
        ('IT', 'IT Assets', true),
        ('FACILITY', 'Facility', true),
        ('VEHICLE', 'Vehicle', true),
        ('OTHER', 'Other', true)
        ON CONFLICT (code) DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_table("asset_audit_events")
    op.drop_table("asset_inventory_information")
    op.drop_table("asset_financial_information")
    op.drop_table("asset_location_information")
    op.drop_table("asset_information")
    op.drop_table("asset_master")
    op.drop_table("asset_import_batches")
    op.drop_table("asset_categories")
