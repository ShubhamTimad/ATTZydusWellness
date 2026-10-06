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

# Block create while the asset is still on another physical order.
# Rejected orders keep their lines for rework, so those assets stay reserved.
# `approved` with completed_at set = closure approved (awaiting Close only) — free for a new PVO.
ORDER_CONFLICT_BLOCK_STATUSES = frozenset(
    (ACTIVE_ORDER_STATUSES - {ORDER_STATUS_APPROVED}) | {ORDER_STATUS_REJECTED}
)

ITEM_STATUS_PENDING = "pending"
ITEM_STATUS_APPROVED = "approved"
ITEM_STATUS_REJECTED = "rejected"

ENTITY_TYPE_CREATION = "physical_order_creation"
ENTITY_TYPE_CLOSURE = "physical_order_closure"

PHYSICAL_ORDER_ENTITY_TYPES = frozenset({ENTITY_TYPE_CREATION, ENTITY_TYPE_CLOSURE})

ACTION_CREATE = "order.create"
ACTION_COMPLETE = "order.complete"

# List UI labels (keep in sync with frontend orderStatusLabel). Search matches these.
SEARCH_STATUS_LABELS: dict[str, str] = {
    ORDER_STATUS_DRAFT: "Draft",
    ORDER_STATUS_PENDING_APPROVAL: "Pending Approval",
    ORDER_STATUS_APPROVED: "Approved",
    ORDER_STATUS_ASSIGNED: "Assigned",
    ORDER_STATUS_IN_PROGRESS: "In Progress",
    ORDER_STATUS_PENDING_CLOSURE: "Completed",
    ORDER_STATUS_COMPLETED: "Completed",
    ORDER_STATUS_CLOSED: "Closed",
    ORDER_STATUS_REJECTED: "Rejected",
    ORDER_STATUS_CANCELLED: "Archived",
}


def status_codes_matching_search(query: str) -> list[str]:
    from core.label_search import codes_matching_label_search

    return codes_matching_label_search(query, SEARCH_STATUS_LABELS)
