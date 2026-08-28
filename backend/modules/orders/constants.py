from __future__ import annotations

ORDER_STATUS_DRAFT = "draft"
ORDER_STATUS_PENDING_APPROVAL = "pending_approval"
ORDER_STATUS_APPROVED = "approved"
ORDER_STATUS_ASSIGNED = "assigned"
ORDER_STATUS_IN_PROGRESS = "in_progress"
ORDER_STATUS_PENDING_CLOSURE = "pending_closure_approval"
ORDER_STATUS_COMPLETED = "completed"
ORDER_STATUS_CLOSED = "closed"
ORDER_STATUS_REJECTED = "rejected"
ORDER_STATUS_CANCELLED = "cancelled"

ACTIVE_ORDER_STATUSES = frozenset(
    {
        ORDER_STATUS_DRAFT,
        ORDER_STATUS_PENDING_APPROVAL,
        ORDER_STATUS_APPROVED,
        ORDER_STATUS_ASSIGNED,
        ORDER_STATUS_IN_PROGRESS,
        ORDER_STATUS_PENDING_CLOSURE,
        ORDER_STATUS_COMPLETED,
    }
)

# Warn on create only when the asset is already being worked on another order.
ORDER_CONFLICT_WARN_STATUSES = frozenset(
    {
        ORDER_STATUS_ASSIGNED,
        ORDER_STATUS_IN_PROGRESS,
    }
)

ITEM_STATUS_PENDING = "pending"
ITEM_STATUS_APPROVED = "approved"
ITEM_STATUS_REJECTED = "rejected"

ENTITY_TYPE_CREATION = "physical_order_creation"
ENTITY_TYPE_CLOSURE = "physical_order_closure"

PHYSICAL_ORDER_ENTITY_TYPES = frozenset({ENTITY_TYPE_CREATION, ENTITY_TYPE_CLOSURE})

ACTION_CREATE = "order.create"
ACTION_COMPLETE = "order.complete"
