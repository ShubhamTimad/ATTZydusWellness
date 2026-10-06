from __future__ import annotations

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from modules.orders.constants import ORDER_CONFLICT_BLOCK_STATUSES, ORDER_STATUS_APPROVED
from modules.orders.model import PhysicalOrder, PhysicalOrderItem


def order_conflict_block_clause():
    """Asset is still on an open or rejected physical order."""
    return or_(
        PhysicalOrder.status.in_(tuple(ORDER_CONFLICT_BLOCK_STATUSES)),
        # Early `approved` (creation-approved, work not done) still blocks.
        and_(PhysicalOrder.status == ORDER_STATUS_APPROVED, PhysicalOrder.completed_at.is_(None)),
    )


def blocking_physical_orders(db: Session, asset_ids: list[int]) -> dict[int, str]:
    """asset_id -> order number of an active physical verification order holding that asset."""
    if not asset_ids:
        return {}
    rows = _rows(
        db.execute(
            select(PhysicalOrderItem.asset_id, PhysicalOrder.order_number)
            .join(PhysicalOrder, PhysicalOrder.id == PhysicalOrderItem.order_id)
            .where(PhysicalOrderItem.asset_id.in_(asset_ids), order_conflict_block_clause())
        )
    )
    return {int(aid): str(onum) for aid, onum in rows}


def finish_existing_order_message(*, kind: str, order_number: str) -> str:
    return (
        f"Still on {kind} {order_number}. "
        "Another order is allowed once the step before Close is done."
    )


def _rows(result) -> list:
    rows = result.all() if hasattr(result, "all") else result
    # ponytail: unit tests pass a MagicMock session; a real query returns a list.
    return list(rows) if isinstance(rows, list) else []


def _matching_orders(db: Session, asset_ids: list[int], item_model, order_model, statuses) -> list:
    if not asset_ids or not statuses:
        return []
    return _rows(
        db.execute(
            select(item_model.asset_id, order_model.id, order_model.order_number, order_model.status)
            .join(order_model, order_model.id == item_model.order_id)
            .where(
                item_model.asset_id.in_(asset_ids),
                order_model.status.in_(tuple(statuses)),
            )
        )
    )


def transfer_hold_statuses() -> frozenset[str]:
    """Open transfer statuses before Central Finance confirm. Confirm is the step before Close."""
    from modules.transfers.constants import ACTIVE_STATUSES, STATUS_CONFIRMED_BY_CF

    return frozenset(ACTIVE_STATUSES - {STATUS_CONFIRMED_BY_CF})


def disposal_hold_statuses() -> frozenset[str]:
    """Open disposal statuses before receive. Receive is the step before Close.

    Receive also marks the asset disposed, so it cannot go on another order after that.
    """
    from modules.disposals.constants import (
        STATUS_DRAFT,
        STATUS_IN_REWORK,
        STATUS_PENDING_APPROVAL,
        STATUS_PENDING_RECEIPT,
        STATUS_REJECTED,
    )

    return frozenset(
        {
            STATUS_DRAFT,
            STATUS_PENDING_APPROVAL,
            STATUS_REJECTED,
            STATUS_IN_REWORK,
            STATUS_PENDING_RECEIPT,
        }
    )


def holding_other_orders(db: Session, asset_ids: list[int]) -> list[tuple[int, int, str, str, str]]:
    """Transfer and disposal orders that still block a new order.

    Each row is (asset_id, order_id, order_number, status, kind).
    """
    from modules.disposals.model import AssetDisposalOrder, AssetDisposalOrderItem
    from modules.transfers.model import AssetTransferOrder, AssetTransferOrderItem

    out: list[tuple[int, int, str, str, str]] = []
    for aid, oid, onum, status in _matching_orders(
        db, asset_ids, AssetTransferOrderItem, AssetTransferOrder, transfer_hold_statuses()
    ):
        out.append((int(aid), int(oid), str(onum), str(status), "Transfer"))
    for aid, oid, onum, status in _matching_orders(
        db, asset_ids, AssetDisposalOrderItem, AssetDisposalOrder, disposal_hold_statuses()
    ):
        out.append((int(aid), int(oid), str(onum), str(status), "Disposal"))
    return out


def released_transfer_asset_ids(db: Session, asset_ids: list[int]) -> set[int]:
    """Assets whose transfer is confirmed and only Close remains."""
    from modules.transfers.constants import STATUS_CONFIRMED_BY_CF
    from modules.transfers.model import AssetTransferOrder, AssetTransferOrderItem

    rows = _matching_orders(
        db, asset_ids, AssetTransferOrderItem, AssetTransferOrder, frozenset({STATUS_CONFIRMED_BY_CF})
    )
    return {int(aid) for aid, *_rest in rows}


def asset_free_for_new_order(lifecycle: str | None, asset_id: int, released_transfer: set[int]) -> bool:
    """Active, or still pending_transfer only because Close has not been clicked yet."""
    state = (lifecycle or "").strip().lower()
    return state == "active" or (state == "pending_transfer" and int(asset_id) in released_transfer)
