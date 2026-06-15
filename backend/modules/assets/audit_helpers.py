from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from modules.assets.field_definitions import ASSET_FIELD_LABELS
from modules.assets.model import AssetMaster
from modules.platform.users.model import User

AUDIT_FIELD_LABELS: dict[str, str] = {
    **ASSET_FIELD_LABELS,
    "tag_color_id": "Tag color",
    "asset_custodian_id": "Asset custodian",
    "asset_condition_id": "Asset condition",
    "asset_category_id": "Asset category",
    "serial_no": "Serial no.",
    "ownership_type": "Ownership",
    "inventory_no": "Inventory no.",
    "asset_description": "Description",
    "engineering_description": "Engineering",
    "qa_description": "QA",
    "pm_equipment_id": "PM equipment ID",
    "plant_id": "Plant",
    "functional_location": "Functional location",
    "actual_location": "Actual location",
    "building": "Building",
    "floor": "Floor",
    "room": "Room",
    "zone": "Zone",
    "cost_center": "Cost center",
    "laboratory": "Laboratory",
    "profit_center": "Profit center",
    "po_number": "PO no.",
    "party_details": "Party details",
    "gross_block": "Gross block",
    "cap_date": "CAP date",
    "inventory_count": "Inventory count",
    "physical_count": "Physical count",
    "last_verification_date": "Last verification date",
    "verification_status": "Verification status",
    "verification_remarks": "Verification remarks",
}


def _norm(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def snapshot_asset(asset: AssetMaster) -> dict[str, Any]:
    state: dict[str, Any] = {
        "asset_name": asset.asset_name,
        "asset_class": asset.asset_class,
        "asset_type": asset.asset_type,
        "asset_code": asset.asset_code,
        "rfid_code": asset.rfid_code,
        "serial_no": asset.serial_no,
        "asset_category_id": asset.asset_category_id,
        "tag_color_id": asset.tag_color_id,
        "asset_custodian_id": asset.asset_custodian_id,
        "asset_condition_id": asset.asset_condition_id,
        "ownership_type": asset.ownership_type,
    }
    if asset.information:
        for k in (
            "inventory_no",
            "asset_description",
            "engineering_description",
            "qa_description",
            "pm_equipment_id",
        ):
            state[k] = getattr(asset.information, k, None)
    if asset.location:
        for k in (
            "plant_id",
            "sub_location",
            "functional_location",
            "actual_location",
            "building",
            "floor",
            "room",
            "zone",
        ):
            state[k] = getattr(asset.location, k, None)
    if asset.financial:
        for k in (
            "cost_center",
            "laboratory",
            "profit_center",
            "party_details",
            "invoice_no",
            "invoice_date",
            "voucher_no",
            "voucher_date",
            "grn_no",
            "grn_date",
            "put_to_use_date",
            "depreciation_rate",
            "gross_block",
            "life_span",
            "cap_date",
            "po_number",
        ):
            state[k] = getattr(asset.financial, k, None)
    if asset.inventory:
        for k in ("verification_status", "verification_remarks"):
            state[k] = getattr(asset.inventory, k, None)
    if asset.information and "pm_equipment_id" not in state:
        state["pm_equipment_id"] = asset.information.pm_equipment_id
    return {k: _norm(v) for k, v in state.items()}


def diff_snapshots(
    before: dict[str, Any], after: dict[str, Any]
) -> dict[str, dict[str, Any]]:
    changes: dict[str, dict[str, Any]] = {}
    for key in set(before) | set(after):
        old = before.get(key)
        new = after.get(key)
        if old != new:
            changes[key] = {"from": old, "to": new}
    return changes


def _display_value(
    key: str,
    value: Any,
    *,
    plant_labels: dict[int, str] | None = None,
    category_labels: dict[int, str] | None = None,
) -> str:
    if value is None or value == "":
        return "—"
    if key == "plant_id" and plant_labels is not None:
        try:
            return plant_labels.get(int(value), str(value))
        except (TypeError, ValueError):
            pass
    if key == "asset_category_id" and category_labels is not None:
        try:
            return category_labels.get(int(value), str(value))
        except (TypeError, ValueError):
            pass
    text = str(value)
    if len(text) > 120:
        return text[:117] + "…"
    return text


def format_changes_detail(
    changes: dict[str, dict[str, Any]],
    *,
    plant_labels: dict[int, str] | None = None,
    category_labels: dict[int, str] | None = None,
) -> list[dict[str, str]]:
    lines: list[dict[str, str]] = []
    for key in sorted(changes.keys(), key=lambda k: AUDIT_FIELD_LABELS.get(k, k)):
        delta = changes[key]
        if not isinstance(delta, dict):
            continue
        label = AUDIT_FIELD_LABELS.get(key, key.replace("_", " "))
        lines.append(
            {
                "field_label": label,
                "from_value": _display_value(
                    key, delta.get("from"), plant_labels=plant_labels, category_labels=category_labels
                ),
                "to_value": _display_value(
                    key, delta.get("to"), plant_labels=plant_labels, category_labels=category_labels
                ),
            }
        )
    return lines


ORDER_ASSET_AUDIT_ACTIONS = frozenset(
    {
        "physical_order_created",
        "physical_order_approved",
        "physical_order_rejected",
        "physical_order_started",
        "physical_order_verified",
        "physical_order_line_rejected",
        "physical_order_completed",
        "physical_verification_reset",
    }
)

# Shown on asset detail audit trail (order lifecycle only).
ASSET_AUDIT_VISIBLE_ORDER_ACTIONS = frozenset(
    {
        "physical_order_created",
        "physical_verification_reset",
        "physical_order_verified",
    }
)


def include_asset_audit_event(
    action: str,
    *,
    new_value: dict[str, Any] | None = None,
) -> bool:
    nv = new_value or {}
    if action == "physical_order_created":
        # Re-audit: reset on approval is shown as "Order created" with count/date changes.
        return not bool(nv.get("pending_reset_on_approval"))
    if action == "physical_order_approved":
        return False
    if action in ORDER_ASSET_AUDIT_ACTIONS:
        return action in ASSET_AUDIT_VISIBLE_ORDER_ACTIONS
    return True


def _format_audit_date_value(value: Any) -> str:
    if value is None or value == "":
        return "—"
    text = str(value)
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        try:
            d = datetime.fromisoformat(text.replace("Z", "+00:00")[:10])
            return d.strftime("%d %b %Y")
        except ValueError:
            pass
    return text


def format_inventory_count_date_lines(
    *,
    old_value: dict[str, Any] | None = None,
    new_value: dict[str, Any] | None = None,
) -> list[dict[str, str]]:
    """Physical count and last verification date only — for asset audit display."""
    ov = old_value or {}
    nv = new_value or {}
    lines: list[dict[str, str]] = []

    old_pc = ov.get("physical_count")
    new_pc = nv.get("physical_count")
    if old_pc != new_pc:
        lines.append(
            {
                "field_label": "Physical count",
                "from_value": "—" if old_pc is None else str(old_pc),
                "to_value": "—" if new_pc is None else str(new_pc),
            }
        )

    old_dt = ov.get("last_verification_date")
    new_dt = nv.get("last_verification_date")
    if old_dt != new_dt:
        lines.append(
            {
                "field_label": "Last verification date",
                "from_value": _format_audit_date_value(old_dt),
                "to_value": _format_audit_date_value(new_dt),
            }
        )

    return lines


def _order_ref(nv: dict[str, Any], ov: dict[str, Any]) -> str:
    order_no = nv.get("order_number") or ov.get("order_number")
    if order_no:
        return str(order_no)
    order_id = nv.get("order_id") or ov.get("order_id")
    return f"#{order_id}" if order_id else ""


def compact_order_audit_text(
    action: str,
    *,
    old_value: dict[str, Any] | None = None,
    new_value: dict[str, Any] | None = None,
) -> str:
    """One-line physical order activity for asset audit (actor shown separately)."""
    ov = old_value or {}
    nv = new_value or {}
    ref = _order_ref(nv, ov)
    prefix = f"{ref} · " if ref else ""

    if action == "physical_order_created":
        return f"{prefix}Order created".lstrip(" · ")
    if action == "physical_order_approved":
        return f"{prefix}Order approved".lstrip(" · ")
    if action == "physical_order_started":
        return f"{prefix}Verification started".lstrip(" · ")
    if action == "physical_order_verified":
        return f"{prefix}Verified".lstrip(" · ")
    if action == "physical_verification_reset":
        return f"{prefix}Order created".lstrip(" · ")
    return f"{prefix}{action.replace('_', ' ')}".lstrip(" · ")


def format_asset_order_audit_lines(
    action: str,
    *,
    old_value: dict[str, Any] | None = None,
    new_value: dict[str, Any] | None = None,
) -> list[dict[str, str]]:
    if action in ("physical_verification_reset", "physical_order_verified"):
        return format_inventory_count_date_lines(old_value=old_value, new_value=new_value)
    return []


def activity_verb_for_action(action: str, new_value: dict[str, Any] | None, source_type: str | None) -> str:
    nv = new_value or {}
    if action == "physical_order_approved":
        return "Order approved"
    if action == "physical_order_started":
        return "Verification started"
    if action == "physical_order_verified":
        return "Verified in order"
    if action == "physical_verification_reset":
        return "Order created"
    if action in ORDER_ASSET_AUDIT_ACTIONS:
        return "Physical order"
    if action == "created":
        source = str(nv.get("source") or "")
        if not source:
            source = source_type or "manual"
        if source == "import":
            return "Imported by"
        if source == "seed":
            return "Created (seed data) by"
        if nv.get("pending_approval"):
            return "Created manually by"
        return "Created manually by"
    if action == "imported":
        return "Imported by"
    if action == "updated":
        return "Edited by"
    if action == "approved":
        return "Approved by"
    if action == "activated":
        return "Activated by"
    if action == "submitted_for_approval":
        return "Submitted for approval by"
    if action == "rejected":
        return "Rejected by"
    if action == "deleted":
        return "Deleted by"
    return action.replace("_", " ").title() + " by"


def format_field_list(keys: list[str]) -> str:
    labels = [AUDIT_FIELD_LABELS.get(k, k.replace("_", " ")) for k in keys]
    if not labels:
        return "Updated"
    if len(labels) <= 4:
        return ", ".join(labels)
    return f"{', '.join(labels[:3])}, +{len(labels) - 3} more"


def actor_display(user: User | None, user_id: int | None) -> str:
    if user is not None:
        return user.full_name or user.email or f"User #{user.id}"
    if user_id is not None:
        return f"User #{user_id}"
    return "System"


def build_audit_summary(
    *,
    action: str,
    actor_name: str,
    new_value: dict[str, Any] | None = None,
    old_value: dict[str, Any] | None = None,
    source_type: str | None = None,
    plant_labels: dict[int, str] | None = None,
    category_labels: dict[int, str] | None = None,
) -> str:
    nv = new_value or {}
    if action == "created":
        source = str(nv.get("source") or "")
        if not source:
            source = source_type or "manual"
        if source == "import":
            return f"Imported by {actor_name}"
        if source == "seed":
            return f"Created (seed data) by {actor_name}"
        return f"Created manually by {actor_name}"
    if action == "imported":
        return f"Imported by {actor_name}"
    if action == "updated":
        changes = nv.get("changes")
        if isinstance(changes, dict) and changes:
            detail_lines = format_changes_detail(
                changes,
                plant_labels=plant_labels,
                category_labels=category_labels,
            )
            if detail_lines:
                body = "\n".join(
                    f"{d['field_label']}: {d['from_value']} → {d['to_value']}" for d in detail_lines
                )
                return f"Edited by {actor_name}:\n{body}"
            fields = format_field_list(list(changes.keys()))
            return f"Edited {fields} by {actor_name}"
        return f"Edited by {actor_name}"
    if action == "approved":
        return f"Approved by {actor_name}"
    if action == "activated":
        return f"Activated by {actor_name} (asset is now active)"
    if action == "submitted_for_approval":
        return f"Submitted for approval by {actor_name} (asset remains inactive until approved)"
    if action == "rejected":
        return f"Rejected by {actor_name} (asset remains inactive)"
    if action == "deleted":
        return f"Deleted by {actor_name}"
    if action in ASSET_AUDIT_VISIBLE_ORDER_ACTIONS:
        text = compact_order_audit_text(action, old_value=old_value, new_value=nv)
        return f"{text} · {actor_name}" if text else f"Physical order · {actor_name}"
    return f"{action.replace('_', ' ').title()} by {actor_name}"
