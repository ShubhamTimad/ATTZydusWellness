"""Per-asset audit entries for physical verification order lifecycle."""

from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from modules.assets.audit_log import log_asset_event
from modules.assets.model import AssetMaster
from modules.orders.model import PhysicalOrder, PhysicalOrderItem


def _order_ref(order: PhysicalOrder) -> dict[str, Any]:
    return {
        "order_id": int(order.id),
        "order_number": order.order_number,
    }


def log_asset_order_created(
    db: Session,
    *,
    asset_id: int,
    order: PhysicalOrder,
    actor_user_id: int | None,
    pending_reset: bool = False,
) -> None:
    log_asset_event(
        db,
        asset_id=asset_id,
        actor_user_id=actor_user_id,
        action="physical_order_created",
        section="inventory",
        new_value={
            **_order_ref(order),
            "order_status": order.status,
            "pending_reset_on_approval": pending_reset,
        },
    )


def log_asset_order_approved(
    db: Session,
    *,
    asset_id: int,
    order: PhysicalOrder,
    actor_user_id: int | None,
) -> None:
    log_asset_event(
        db,
        asset_id=asset_id,
        actor_user_id=actor_user_id,
        action="physical_order_approved",
        section="inventory",
        new_value=_order_ref(order),
    )


def log_asset_order_rejected(
    db: Session,
    *,
    asset_id: int,
    order: PhysicalOrder,
    actor_user_id: int | None,
    reason: str | None,
    phase: str,
) -> None:
    log_asset_event(
        db,
        asset_id=asset_id,
        actor_user_id=actor_user_id,
        action="physical_order_rejected",
        section="inventory",
        new_value={**_order_ref(order), "phase": phase, "reason": reason},
    )


def log_asset_order_started(
    db: Session,
    *,
    asset_id: int,
    order: PhysicalOrder,
    actor_user_id: int | None,
) -> None:
    log_asset_event(
        db,
        asset_id=asset_id,
        actor_user_id=actor_user_id,
        action="physical_order_started",
        section="inventory",
        new_value=_order_ref(order),
    )


def log_asset_physically_verified(
    db: Session,
    *,
    asset: AssetMaster,
    order: PhysicalOrder,
    actor_user_id: int | None,
    old_physical: int | None,
    old_verified: date | None,
) -> None:
    inv = asset.inventory
    new_physical = inv.physical_count if inv else 1
    new_verified = inv.last_verification_date if inv else date.today()
    log_asset_event(
        db,
        asset_id=int(asset.id),
        actor_user_id=actor_user_id,
        action="physical_order_verified",
        section="inventory",
        old_value={
            "physical_count": old_physical,
            "last_verification_date": old_verified.isoformat() if old_verified else None,
        },
        new_value={
            **_order_ref(order),
            "physical_count": new_physical,
            "last_verification_date": new_verified.isoformat() if new_verified else None,
        },
    )


def log_asset_line_rejected(
    db: Session,
    *,
    asset_id: int,
    order: PhysicalOrder,
    actor_user_id: int | None,
    reason: str,
    phase: str,
    asset_code: str,
) -> None:
    log_asset_event(
        db,
        asset_id=asset_id,
        actor_user_id=actor_user_id,
        action="physical_order_line_rejected",
        section="inventory",
        new_value={
            **_order_ref(order),
            "asset_code": asset_code,
            "phase": phase,
            "reason": reason,
        },
    )


def log_asset_order_completed(
    db: Session,
    *,
    asset_id: int,
    order: PhysicalOrder,
    actor_user_id: int | None,
) -> None:
    log_asset_event(
        db,
        asset_id=asset_id,
        actor_user_id=actor_user_id,
        action="physical_order_completed",
        section="inventory",
        new_value=_order_ref(order),
    )


def log_assets_for_order_items(
    db: Session,
    order: PhysicalOrder,
    *,
    actor_user_id: int | None,
    reset_asset_ids: set[int],
    action: str,
    reason: str | None = None,
    phase: str | None = None,
) -> None:
    """Log the same lifecycle action for every line on the order."""
    for item in order.items:
        aid = int(item.asset_id)
        if action == "created":
            log_asset_order_created(
                db,
                asset_id=aid,
                order=order,
                actor_user_id=actor_user_id,
                pending_reset=aid in reset_asset_ids,
            )
        elif action == "approved":
            if item.verification_status != "rejected":
                log_asset_order_approved(db, asset_id=aid, order=order, actor_user_id=actor_user_id)
        elif action == "rejected":
            log_asset_order_rejected(
                db,
                asset_id=aid,
                order=order,
                actor_user_id=actor_user_id,
                reason=reason,
                phase=phase or "creation",
            )
        elif action == "started":
            if item.verification_status != "rejected":
                log_asset_order_started(db, asset_id=aid, order=order, actor_user_id=actor_user_id)
        elif action == "completed":
            if item.verification_status != "rejected":
                log_asset_order_completed(db, asset_id=aid, order=order, actor_user_id=actor_user_id)


def rejected_item_asset_ids(order: PhysicalOrder) -> set[int]:
    return {int(i.asset_id) for i in order.items if i.verification_status == "rejected"}
