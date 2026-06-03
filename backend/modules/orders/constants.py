from __future__ import annotations

ORDER_STATUS_DRAFT = "draft"
ORDER_STATUS_PENDING_APPROVAL = "pending_approval"
ORDER_STATUS_APPROVED = "approved"
ORDER_STATUS_IN_PROGRESS = "in_progress"
ORDER_STATUS_PENDING_CLOSURE = "pending_closure_approval"
ORDER_STATUS_COMPLETED = "completed"
ORDER_STATUS_REJECTED = "rejected"
ORDER_STATUS_CANCELLED = "cancelled"

ACTIVE_ORDER_STATUSES = frozenset(
    {
        ORDER_STATUS_DRAFT,
        ORDER_STATUS_PENDING_APPROVAL,
        ORDER_STATUS_APPROVED,
        ORDER_STATUS_IN_PROGRESS,
        ORDER_STATUS_PENDING_CLOSURE,
    }
)

ITEM_STATUS_PENDING = "pending"
ITEM_STATUS_APPROVED = "approved"
ITEM_STATUS_REJECTED = "rejected"

ENTITY_TYPE_CREATION = "physical_order_creation"
ENTITY_TYPE_CLOSURE = "physical_order_closure"

ACTION_CREATE = "order.create"
ACTION_COMPLETE = "order.complete"
