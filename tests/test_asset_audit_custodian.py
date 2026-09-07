"""Asset audit trail should show custodian names, not user IDs."""

from __future__ import annotations

from modules.assets.audit_helpers import build_audit_summary, format_changes_detail


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
