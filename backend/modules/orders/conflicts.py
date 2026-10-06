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
    rows = db.execute(
        select(PhysicalOrderItem.asset_id, PhysicalOrder.order_number)
        .join(PhysicalOrder, PhysicalOrder.id == PhysicalOrderItem.order_id)
        .where(PhysicalOrderItem.asset_id.in_(asset_ids), order_conflict_block_clause())
    ).all()
    return {int(aid): str(onum) for aid, onum in rows}
