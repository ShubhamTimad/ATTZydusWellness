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
            "field_label": "Asset custodian",
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
    assert "12" not in summary
    assert "5" not in summary


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
    assert by_label["Actual location 2"] == {
        "field_label": "Actual location 2",
        "from_value": "Production Bay 1",
        "to_value": "QC Bay 1",
    }
    assert by_label["Cost Center Code"]["from_value"] == "Production"
    assert by_label["Cost Center Code"]["to_value"] == "QC & Quality"


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
