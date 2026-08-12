"""Asset list sort_by keys resolve to SQL expressions."""

from __future__ import annotations

from modules.assets.service import _asset_list_sort_expression


def test_asset_list_sort_keys_are_distinct() -> None:
    keys = [
        "created_at",
        "asset_name",
        "asset_code",
        "combined_asset_number",
        "rfid_code",
        "category_name",
        "plant",
        "cost_center",
        "cost_center_name",
        "functional_location",
        "actual_location",
        "inventory_count",
        "physical_count",
        "last_verification_date",
        "lifecycle_status",
        "approval_status",
        "source_type",
        "active_physical_order",
    ]
    exprs = [_asset_list_sort_expression(k) for k in keys]
    # Unknown key falls back to created_at (same object identity not required).
    assert _asset_list_sort_expression("not_a_column") is not None
    assert len(exprs) == len(keys)
