"""Asset audit trail should show custodian names, not user IDs."""

from __future__ import annotations

from modules.assets.audit_helpers import (
    build_audit_summary,
    format_changes_detail,
    format_rfid_audit_lines,
)


def test_format_changes_detail_resolves_custodian_ids_to_names() -> None:
    lines = format_changes_detail(
        {"asset_custodian_id": {"from": 12, "to": 5}},
        user_labels={12: "Operator Demo", 5: "Approver Demo"},
    )
    assert lines == [
        {
            "field_label": "Asset Custodian",
            "from_value": "Operator Demo",
            "to_value": "Approver Demo",
        }
    ]


def test_build_audit_summary_uses_custodian_names() -> None:
    summary = build_audit_summary(
        action="updated",
        actor_name="Operator Demo",
        new_value={"changes": {"asset_custodian_id": {"from": 12, "to": 5}}},
        user_labels={12: "Alice", 5: "Bob"},
    )
    assert "Alice → Bob" in summary
    assert summary.startswith("Updated by Operator Demo")
    assert "12" not in summary
    assert "5" not in summary


def test_cleared_asset_number_shows_dash() -> None:
    lines = format_changes_detail({"asset_code": {"from": "AST-1001", "to": ""}})
    assert lines == [
        {
            "field_label": "Asset Number",
            "from_value": "AST-1001",
            "to_value": "—",
        }
    ]
    lines_none = format_changes_detail({"asset_code": {"from": "AST-1001", "to": None}})
    assert lines_none[0]["to_value"] == "—"


def test_format_changes_detail_resolves_location_and_cost_center_codes() -> None:
    lines = format_changes_detail(
        {
            "functional_location": {"from": "FL-PROD", "to": "FL-QC"},
            "actual_location": {"from": "AL-PROD-01", "to": "AL-QC-01"},
            "cost_center": {"from": "CC-4100", "to": "CC-4200"},
        },
        code_labels={
            "fl-prod": "Production Floor",
            "fl-qc": "QC Floor",
            "al-prod-01": "Production Bay 1",
            "al-qc-01": "QC Bay 1",
            "cc-4100": "Production",
            "cc-4200": "QC & Quality",
        },
    )
    by_label = {line["field_label"]: line for line in lines}
    assert by_label["Actual Location 1"] == {
        "field_label": "Actual Location 1",
        "from_value": "Production Floor",
        "to_value": "QC Floor",
    }
    assert by_label["Actual Location 2"] == {
        "field_label": "Actual Location 2",
        "from_value": "Production Bay 1",
        "to_value": "QC Bay 1",
    }
    assert by_label["Cost Center Code"]["from_value"] == "Production"
    assert by_label["Cost Center Code"]["to_value"] == "QC & Quality"


def test_format_changes_detail_keeps_fl_and_al_when_codes_collide() -> None:
    """Same stored code for Location 1 and 2 must not show Location 2 on both lines."""
    lines = format_changes_detail(
        {
            "functional_location": {"from": "WH-01", "to": "WH-02"},
            "actual_location": {"from": "WH-01", "to": "WH-02"},
        },
        code_labels={
            "fl:wh-01": "Warehouse A",
            "fl:wh-02": "Warehouse B",
            "al:wh-01": "Bay 1",
            "al:wh-02": "Bay 2",
            "al:wh-01:wh-01": "Bay 1",
            "al:wh-02:wh-02": "Bay 2",
        },
    )
    by_label = {line["field_label"]: line for line in lines}
    assert by_label["Actual Location 1"]["from_value"] == "Warehouse A"
    assert by_label["Actual Location 1"]["to_value"] == "Warehouse B"
    assert by_label["Actual Location 2"]["from_value"] == "Bay 1"
    assert by_label["Actual Location 2"]["to_value"] == "Bay 2"


def test_format_changes_detail_skips_class_id_when_name_present() -> None:
    lines = format_changes_detail(
        {
            "asset_class": {"from": "Facility Asset", "to": None},
            "asset_class_id": {"from": 2, "to": None},
        }
    )
    assert lines == [
        {
            "field_label": "Asset Class",
            "from_value": "Facility Asset",
            "to_value": "—",
        }
    ]


def test_rfid_attach_shows_code_and_update_shows_from_to() -> None:
    attached = format_rfid_audit_lines(
        old_value={"rfid_code": None},
        new_value={"rfid_code": "RFID-100"},
    )
    assert attached == [
        {"field_label": "RFID Code", "from_value": "—", "to_value": "RFID-100"}
    ]
    updated = format_rfid_audit_lines(
        old_value={"rfid_code": "RFID-100"},
        new_value={"rfid_code": "RFID-200"},
    )
    assert updated[0]["from_value"] == "RFID-100"
    assert updated[0]["to_value"] == "RFID-200"
    summary = build_audit_summary(
        action="rfid_updated",
        actor_name="Operator Demo",
        old_value={"rfid_code": "RFID-100"},
        new_value={"rfid_code": "RFID-200"},
    )
    assert "RFID-100 → RFID-200" in summary


def test_format_changes_detail_resolves_tag_color_ids_to_names() -> None:
    lines = format_changes_detail(
        {"tag_color_id": {"from": 1, "to": 2}},
        id_labels={"tag_color_id": {1: "Red", 2: "Blue"}},
    )
    assert lines[0]["from_value"] == "Red"
    assert lines[0]["to_value"] == "Blue"


def test_inventory_audit_dates_use_dd_mm_yy() -> None:
    from datetime import date

    from modules.assets.audit_helpers import format_inventory_count_date_lines

    lines = format_inventory_count_date_lines(
        old_value={"last_verification_date": "2026-09-17", "physical_count": 1},
        new_value={"last_verification_date": None, "physical_count": 0},
    )
    by_label = {line["field_label"]: line for line in lines}
    assert by_label["Last verification date"]["from_value"] == "17/09/26"
    assert by_label["Last verification date"]["to_value"] == "—"

    lines_date = format_inventory_count_date_lines(
        old_value={"last_verification_date": date(2026, 9, 17)},
        new_value={"last_verification_date": date(2026, 9, 18)},
    )
    assert lines_date[0]["from_value"] == "17/09/26"
    assert lines_date[0]["to_value"] == "18/09/26"
