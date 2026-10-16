"""Asset active/inactive lifecycle tied to approval workflows."""

from __future__ import annotations

import os
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from modules.assets.model import AssetMaster

# entity_type → in-app page (approval mail must not use /dashboard/tasks).
_ENTITY_ACTION_PATHS: dict[str, str] = {
    "physical_order_creation": "/dashboard/orders/{id}",
    "physical_order_closure": "/dashboard/orders/{id}",
    "transfer_order": "/dashboard/transfer-orders/{id}",
    "disposal_order": "/dashboard/disposal-orders/{id}",
    "disposal_order_engineering": "/dashboard/disposal-orders/{id}",
    "capitalization_request": "/dashboard/capitalization/{id}",
    "capitalization_request_engineering": "/dashboard/capitalization/{id}",
    "asset_creation": "/dashboard/assets/{id}",
    "asset_import": "/dashboard/assets/{id}",
    "user_creation": "/dashboard/users/{id}",
}

_ENTITY_LABELS: dict[str, str] = {
    "physical_order_creation": "Order",
    "physical_order_closure": "Order",
    "transfer_order": "Transfer",
    "disposal_order": "Disposal",
    "disposal_order_engineering": "Disposal",
    "capitalization_request": "Form",
    "capitalization_request_engineering": "Form",
    "asset_creation": "Asset",
    "asset_import": "Asset",
    "user_creation": "User",
}

# Canonical lifecycle values stored on ``asset_master.lifecycle_status``.
LIFECYCLE_ACTIVE = "active"
LIFECYCLE_INACTIVE = "inactive"
# Manually taken out of service (not the same as draft/pending inactive).
LIFECYCLE_DEACTIVATED = "deactivated"
# Reserved by an open disposal order draft / in-flight disposal.
LIFECYCLE_PENDING_DISPOSAL = "pending_disposal"
# Reserved by an open transfer order draft / in-flight transfer.
LIFECYCLE_PENDING_TRANSFER = "pending_transfer"
# Scrapped via a closed disposal order — terminal, never reactivated.
LIFECYCLE_DISPOSED = "disposed"
# Legacy rows may still use this until migrated; treat as inactive + pending approval.
LIFECYCLE_PENDING_LEGACY = "pending_approval"

LIFECYCLE_AWAITING_APPROVAL = frozenset({LIFECYCLE_INACTIVE, LIFECYCLE_PENDING_LEGACY})
# List filter "Inactive" includes draft/pending inactive, manual deactivation, and disposal.
LIFECYCLE_INACTIVE_FILTER = frozenset(
    {
        LIFECYCLE_INACTIVE,
        LIFECYCLE_PENDING_LEGACY,
        LIFECYCLE_DEACTIVATED,
        LIFECYCLE_PENDING_DISPOSAL,
        LIFECYCLE_PENDING_TRANSFER,
        LIFECYCLE_DISPOSED,
    }
)

# Not yet sent into an approval workflow (create/import only).
APPROVAL_DRAFT = "draft"
APPROVAL_PENDING = "pending"
APPROVAL_REJECTED = "rejected"
APPROVAL_APPROVED = "approved"

# Badge "Approved" is approval_status=approved unless lifecycle overrides the label.
APPROVED_LIST_HIDDEN_LIFECYCLES = frozenset(
    {
        LIFECYCLE_PENDING_DISPOSAL,
        LIFECYCLE_PENDING_TRANSFER,
        LIFECYCLE_DISPOSED,
        LIFECYCLE_DEACTIVATED,
    }
)


def is_awaiting_approval(lifecycle_status: str | None, approval_status: str | None = None) -> bool:
    if (approval_status or "").strip().lower() == APPROVAL_PENDING:
        return True
    return (lifecycle_status or "").strip().lower() in LIFECYCLE_AWAITING_APPROVAL and (
        approval_status or ""
    ).strip().lower() == APPROVAL_PENDING


def is_inactive_display(lifecycle_status: str | None, approval_status: str | None) -> bool:
    if is_operational(lifecycle_status):
        return False
    return True


def can_submit_for_approval(asset: AssetMaster) -> bool:
    """Asset may be sent into approval (draft, rejected, or legacy inactive + not_required)."""
    if is_operational(asset.lifecycle_status):
        return False
    status = (asset.approval_status or "").strip().lower()
    if status == APPROVAL_PENDING:
        return False
    if status in (APPROVAL_DRAFT, APPROVAL_REJECTED):
        return True
    if status == "not_required" and (asset.lifecycle_status or "").strip().lower() in (
        LIFECYCLE_INACTIVE,
        LIFECYCLE_PENDING_LEGACY,
    ):
        return True
    return False


def set_asset_inactive_draft(asset: AssetMaster) -> None:
    """Created or imported — inactive until user submits for approval."""
    asset.lifecycle_status = LIFECYCLE_INACTIVE
    asset.approval_status = APPROVAL_DRAFT


def is_operational(lifecycle_status: str | None) -> bool:
    return (lifecycle_status or "").strip().lower() == LIFECYCLE_ACTIVE


def can_deactivate(asset: AssetMaster) -> bool:
    """Operational assets may be manually taken out of service."""
    return is_operational(asset.lifecycle_status) and (
        (asset.approval_status or "").strip().lower() != APPROVAL_PENDING
    )


def is_disposed(lifecycle_status: str | None) -> bool:
    return (lifecycle_status or "").strip().lower() == LIFECYCLE_DISPOSED


def is_pending_disposal(lifecycle_status: str | None) -> bool:
    return (lifecycle_status or "").strip().lower() == LIFECYCLE_PENDING_DISPOSAL


def mark_pending_disposal(asset: AssetMaster) -> dict[str, Any]:
    """Asset is locked for an open disposal order and cannot be reused elsewhere."""
    before = {"lifecycle_status": asset.lifecycle_status, "approval_status": asset.approval_status}
    asset.lifecycle_status = LIFECYCLE_PENDING_DISPOSAL
    return {
        "before": before,
        "after": {"lifecycle_status": asset.lifecycle_status, "approval_status": asset.approval_status},
    }


def restore_from_pending_disposal(asset: AssetMaster) -> dict[str, Any]:
    """Draft disposal removed/cancelled before completion — make the asset usable again."""
    before = {"lifecycle_status": asset.lifecycle_status, "approval_status": asset.approval_status}
    asset.lifecycle_status = LIFECYCLE_ACTIVE
    return {
        "before": before,
        "after": {"lifecycle_status": asset.lifecycle_status, "approval_status": asset.approval_status},
    }


def is_pending_transfer(lifecycle_status: str | None) -> bool:
    return (lifecycle_status or "").strip().lower() == LIFECYCLE_PENDING_TRANSFER


def mark_pending_transfer(asset: AssetMaster) -> dict[str, Any]:
    """Asset is locked for an open transfer order and cannot be reused elsewhere."""
    before = {"lifecycle_status": asset.lifecycle_status, "approval_status": asset.approval_status}
    asset.lifecycle_status = LIFECYCLE_PENDING_TRANSFER
    return {
        "before": before,
        "after": {"lifecycle_status": asset.lifecycle_status, "approval_status": asset.approval_status},
    }


def restore_from_pending_transfer(asset: AssetMaster) -> dict[str, Any]:
    """Transfer archived/deleted/closed — asset is approved/active again."""
    before = {"lifecycle_status": asset.lifecycle_status, "approval_status": asset.approval_status}
    asset.lifecycle_status = LIFECYCLE_ACTIVE
    return {
        "before": before,
        "after": {"lifecycle_status": asset.lifecycle_status, "approval_status": asset.approval_status},
    }


def mark_disposed(asset: AssetMaster) -> dict[str, Any]:
    """Terminal state set when the scrapyard receives a disposal order (stage before CF close)."""
    before = {"lifecycle_status": asset.lifecycle_status, "approval_status": asset.approval_status}
    asset.lifecycle_status = LIFECYCLE_DISPOSED
    asset.approval_status = "not_required"
    return {
        "before": before,
        "after": {"lifecycle_status": asset.lifecycle_status, "approval_status": asset.approval_status},
    }


def can_reactivate(asset: AssetMaster) -> bool:
    """Only manually deactivated assets can be brought back without re-approval."""
    return (asset.lifecycle_status or "").strip().lower() == LIFECYCLE_DEACTIVATED


def set_asset_deactivated(asset: AssetMaster) -> dict[str, Any]:
    before = {"lifecycle_status": asset.lifecycle_status, "approval_status": asset.approval_status}
    asset.lifecycle_status = LIFECYCLE_DEACTIVATED
    return {
        "before": before,
        "after": {"lifecycle_status": asset.lifecycle_status, "approval_status": asset.approval_status},
    }


def set_asset_reactivated(asset: AssetMaster) -> dict[str, Any]:
    before = {"lifecycle_status": asset.lifecycle_status, "approval_status": asset.approval_status}
    asset.lifecycle_status = LIFECYCLE_ACTIVE
    return {
        "before": before,
        "after": {"lifecycle_status": asset.lifecycle_status, "approval_status": asset.approval_status},
    }


def asset_approval_payload(asset: AssetMaster, *, action_code: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "action_code": action_code,
        "asset_name": asset.asset_name,
        "asset_code": asset.asset_code,
        "rfid_code": asset.rfid_code,
        "serial_no": asset.serial_no,
        "asset_category_id": asset.asset_category_id,
        "source_type": asset.source_type,
    }
    if extra:
        payload.update(extra)
    return payload


def set_asset_active_immediate(asset: AssetMaster) -> None:
    """No workflow — asset is usable immediately."""
    asset.lifecycle_status = LIFECYCLE_ACTIVE
    asset.approval_status = "not_required"


def set_asset_pending_approval(asset: AssetMaster) -> None:
    """Workflow assigned — inactive until all approval levels complete."""
    asset.lifecycle_status = LIFECYCLE_INACTIVE
    asset.approval_status = "pending"


def set_asset_approved_active(asset: AssetMaster, *, approver_user_id: int | None) -> dict[str, Any]:
    before = {"lifecycle_status": asset.lifecycle_status, "approval_status": asset.approval_status}
    asset.lifecycle_status = LIFECYCLE_ACTIVE
    asset.approval_status = "approved"
    asset.approved_by = approver_user_id
    return {
        "before": before,
        "after": {"lifecycle_status": asset.lifecycle_status, "approval_status": asset.approval_status},
    }


def set_asset_rejected_inactive(asset: AssetMaster) -> dict[str, Any]:
    before = {"lifecycle_status": asset.lifecycle_status, "approval_status": asset.approval_status}
    asset.lifecycle_status = LIFECYCLE_INACTIVE
    asset.approval_status = "rejected"
    return {
        "before": before,
        "after": {"lifecycle_status": asset.lifecycle_status, "approval_status": asset.approval_status},
    }


def refresh_asset_request_payload(asset: AssetMaster, *, action_code: str) -> dict[str, Any]:
    return asset_approval_payload(asset, action_code=action_code)


def approval_task_title(entity_type: str, payload: dict[str, Any] | None) -> str:
    p = payload or {}
    name = p.get("asset_name")
    code = p.get("asset_code")
    label = None
    if isinstance(name, str) and name.strip():
        label = name.strip()
        if isinstance(code, str) and code.strip():
            label = f"{label} ({code.strip()})"
    elif isinstance(code, str) and code.strip():
        label = code.strip()
    if entity_type == "asset_creation":
        return f"Approve new asset: {label or 'Asset'}"
    if entity_type == "asset_import":
        return f"Approve imported asset: {label or 'Asset'}"
    if entity_type == "user_creation":
        nm = p.get("full_name")
        if isinstance(nm, str) and nm.strip():
            return f"Approve new user: {nm.strip()}"
        return "Approve new user"
    if entity_type == "physical_order_creation":
        onum = p.get("order_number")
        if isinstance(onum, str) and onum.strip():
            return f"Approve physical order: {onum.strip()}"
        return "Approve physical order"
    if entity_type == "physical_order_closure":
        onum = p.get("order_number")
        if isinstance(onum, str) and onum.strip():
            return f"Approve order closure: {onum.strip()}"
        return "Approve order closure"
    if entity_type in ("capitalization_request", "capitalization_request_engineering"):
        fnum = p.get("form_number")
        aname = p.get("asset_name")
        if isinstance(fnum, str) and fnum.strip():
            label = fnum.strip()
            if isinstance(aname, str) and aname.strip():
                label = f"{label}: {aname.strip()}"
            return f"Approve capitalization form: {label}"
        return "Approve capitalization form"
    if entity_type in ("disposal_order", "disposal_order_engineering"):
        onum = p.get("order_number")
        if isinstance(onum, str) and onum.strip():
            return f"Approve asset disposal: {onum.strip()}"
        return "Approve asset disposal"
    if entity_type == "transfer_order":
        onum = p.get("order_number")
        if isinstance(onum, str) and onum.strip():
            return f"Approve asset transfer: {onum.strip()}"
        return "Approve asset transfer"
    return f"Approval: {entity_type.replace('_', ' ')}"


def frontend_app_base() -> str:
    return (
        os.environ.get("FRONTEND_APP_URL") or os.environ.get("FRONTEND_ORIGIN") or "http://localhost:5173"
    ).rstrip("/")


def entity_label_for_type(entity_type: str) -> str:
    return _ENTITY_LABELS.get(str(entity_type or ""), "Record")


def approval_action_link(entity_type: str, entity_id: int) -> str:
    path = _ENTITY_ACTION_PATHS.get(str(entity_type or ""), "/dashboard").format(id=int(entity_id))
    return f"{frontend_app_base()}{path}"


def entity_display_name(entity_type: str, payload: dict[str, Any] | None, entity_id: int) -> str:
    p = payload or {}
    if entity_type in ("asset_creation", "asset_import"):
        name = p.get("asset_name")
        code = p.get("asset_code")
        if isinstance(name, str) and name.strip():
            if isinstance(code, str) and code.strip():
                return f"{name.strip()} ({code.strip()})"
            return name.strip()
        if isinstance(code, str) and code.strip():
            return code.strip()
    if entity_type == "user_creation":
        nm = p.get("full_name")
        if isinstance(nm, str) and nm.strip():
            return nm.strip()
    if entity_type in ("physical_order_creation", "physical_order_closure"):
        onum = p.get("order_number")
        if isinstance(onum, str) and onum.strip():
            return onum.strip()
    if entity_type in ("capitalization_request", "capitalization_request_engineering"):
        fnum = p.get("form_number")
        if isinstance(fnum, str) and fnum.strip():
            return fnum.strip()
        aname = p.get("asset_name")
        if isinstance(aname, str) and aname.strip():
            return aname.strip()
    if entity_type in ("disposal_order", "disposal_order_engineering"):
        onum = p.get("order_number")
        if isinstance(onum, str) and onum.strip():
            return onum.strip()
    if entity_type == "transfer_order":
        onum = p.get("order_number")
        if isinstance(onum, str) and onum.strip():
            return onum.strip()
    return f"{entity_type}:{entity_id}"


def find_open_asset_approval_request(db: Session, *, asset_id: int):
    from modules.platform.approvals.model import ApprovalRequest

    return db.scalar(
        select(ApprovalRequest)
        .where(
            ApprovalRequest.entity_type.in_(("asset_creation", "asset_import")),
            ApprovalRequest.entity_id == int(asset_id),
            ApprovalRequest.status.in_(("in_rework", "rejected")),
        )
        .order_by(ApprovalRequest.id.desc())
        .limit(1)
    )


def find_pending_asset_approval_request(db: Session, *, asset_id: int):
    from modules.platform.approvals.model import ApprovalRequest

    return db.scalar(
        select(ApprovalRequest)
        .where(
            ApprovalRequest.entity_type.in_(("asset_creation", "asset_import")),
            ApprovalRequest.entity_id == int(asset_id),
            ApprovalRequest.status == "pending",
        )
        .order_by(ApprovalRequest.id.desc())
        .limit(1)
    )


def find_latest_asset_approval_request(db: Session, *, asset_id: int):
    """Most recent approval request for an asset (any status) for detail progress UI."""
    from modules.platform.approvals.model import ApprovalRequest

    return db.scalar(
        select(ApprovalRequest)
        .where(
            ApprovalRequest.entity_type.in_(("asset_creation", "asset_import")),
            ApprovalRequest.entity_id == int(asset_id),
        )
        .order_by(ApprovalRequest.id.desc())
        .limit(1)
    )


def action_codes_for_asset(asset: AssetMaster) -> tuple[str, str]:
    if (asset.source_type or "").strip().lower() == "import":
        return "asset.import", "asset_import"
    return "asset.create", "asset_creation"
