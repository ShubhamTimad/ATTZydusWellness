"""Keep physical-order work out of the generic My Tasks inbox."""

from __future__ import annotations

from modules.orders.constants import PHYSICAL_ORDER_ENTITY_TYPES
from modules.platform.approvals.model import ApprovalTask


def is_physical_order_task(task: ApprovalTask) -> bool:
    if task.entity_type and str(task.entity_type) in PHYSICAL_ORDER_ENTITY_TYPES:
        return True
    req = task.request
    return req is not None and str(req.entity_type) in PHYSICAL_ORDER_ENTITY_TYPES
