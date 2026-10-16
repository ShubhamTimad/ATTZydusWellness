"""Title-case asset field config display labels."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "079"
down_revision = "078"
branch_labels = None
depends_on = None

# field_key → (new_label, previous_label for downgrade)
_LABELS: dict[str, tuple[str, str]] = {
    "asset_name": ("Asset Name", "Asset name"),
    "asset_class": ("Asset Class", "Asset class"),
    "asset_class_id": ("Asset Class", "Asset class"),
    "asset_class_code": ("Asset Class", "Asset class"),
    "asset_type": ("Asset Type", "Asset type"),
    "asset_category_id": ("Asset Category", "Asset category"),
    "category_code": ("Asset Category", "Asset category"),
    "tag_color_id": ("Tag Color", "Tag color"),
    "tag_color_code": ("Tag Color", "Tag color"),
    "serial_no": ("Serial No.", "Serial no."),
    "ownership_type": ("Ownership Type", "Ownership type"),
    "inventory_no": ("Inventory No.", "Inventory no."),
    "engineering_description": ("Engineering Description", "Engineering description"),
    "qa_description": ("QA Description", "QA description"),
    "asset_allocation": ("Asset Allocation", "Asset allocation"),
    "pm_equipment_id": ("PM Equipment ID", "PM equipment ID"),
    "sub_location": ("Sub Location", "Sub location"),
    "actual_location": ("Actual Location 2", "Actual location 2"),
    "capitalization_form_number": ("CapEx Form Number", "CapEx form number"),
    "profit_center": ("Profit Center", "Profit center"),
    "invoice_no": ("Invoice No.", "Invoice no."),
    "invoice_date": ("Invoice Date", "Invoice date"),
    "voucher_no": ("Voucher No.", "Voucher no."),
    "voucher_date": ("Voucher Date", "Voucher date"),
    "grn_no": ("GRN No.", "GRN no."),
    "grn_date": ("GRN Date", "GRN date"),
    "put_to_use_date": ("Put to Use", "Put to use"),
    "depreciation_rate": ("Rate of Depreciation", "Rate of depreciation"),
    "vendor_name": ("Vendor Name", "Vendor name"),
    "po_number": ("PO Number", "PO number"),
    "inventory_count": ("Inventory Count", "Inventory count"),
    "physical_count": ("Physical Count", "Physical count"),
    "last_verification_date": ("Last Verification Date", "Last verification date"),
    "fy_verification_count": ("Verifications This FY", "Verifications this FY"),
    "physical_order_id": ("Physical Order ID", "Physical order ID"),
    "physical_order_status": ("Order Status", "Order status"),
    "verification_status": ("Verification Status", "Verification status"),
    "verification_remarks": ("Verification Remarks", "Verification remarks"),
    "category_name": ("Category Description", "Category description"),
    "lifecycle_status": ("Lifecycle Status", "Lifecycle status"),
    "approval_status": ("Approval Status", "Approval status"),
}


def upgrade() -> None:
    conn = op.get_bind()
    has_field_config = conn.execute(
        sa.text("SELECT to_regclass('public.asset_field_config') IS NOT NULL")
    ).scalar()
    if not has_field_config:
        return

    for field_key, (new_label, _) in _LABELS.items():
        op.execute(
            sa.text(
                """
                UPDATE asset_field_config
                SET display_label = :label
                WHERE field_key = :field_key
                """
            ).bindparams(label=new_label, field_key=field_key)
        )


def downgrade() -> None:
    conn = op.get_bind()
    has_field_config = conn.execute(
        sa.text("SELECT to_regclass('public.asset_field_config') IS NOT NULL")
    ).scalar()
    if not has_field_config:
        return

    for field_key, (_, old_label) in _LABELS.items():
        op.execute(
            sa.text(
                """
                UPDATE asset_field_config
                SET display_label = :label
                WHERE field_key = :field_key
                """
            ).bindparams(label=old_label, field_key=field_key)
        )
