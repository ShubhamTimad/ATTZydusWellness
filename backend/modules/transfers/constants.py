from __future__ import annotations

STATUS_DRAFT = "draft"
STATUS_ASSIGNED_TO_CF = "assigned_to_cf"
STATUS_REJECTED = "rejected"
STATUS_APPROVED_BY_CF = "approved_by_cf"
STATUS_RECEIVED_BY_CC2 = "received_by_cc2"
STATUS_CONFIRMED_BY_CF = "confirmed_by_cf"
STATUS_CLOSED = "closed"
STATUS_CANCELLED = "cancelled"

EDITABLE_STATUSES = frozenset({STATUS_DRAFT, STATUS_REJECTED})
# CF may reject before close; assets are rolled back if receive already applied.
REJECTABLE_STATUSES = frozenset(
    {
        STATUS_ASSIGNED_TO_CF,
        STATUS_APPROVED_BY_CF,
        STATUS_RECEIVED_BY_CC2,
        STATUS_CONFIRMED_BY_CF,
    }
)
ACTIVE_STATUSES = frozenset(
    {
        STATUS_DRAFT,
        STATUS_ASSIGNED_TO_CF,
        STATUS_REJECTED,
        STATUS_APPROVED_BY_CF,
        STATUS_RECEIVED_BY_CC2,
        STATUS_CONFIRMED_BY_CF,
    }
)

# Role names (must match seeded CapEx / org roles).
ROLE_COST_CENTER_USER = "Cost Center User"
ROLE_CENTRAL_FINANCE = "Central Finance"

ASSIGNEE_LEVEL_ROLES: dict[str, str] = {
    "cost_center": ROLE_COST_CENTER_USER,
    "central_finance": ROLE_CENTRAL_FINANCE,
}

STATUS_LABELS: dict[str, str] = {
    STATUS_DRAFT: "Draft",
    STATUS_ASSIGNED_TO_CF: "Assigned to CF",
    STATUS_REJECTED: "Rejected",
    STATUS_APPROVED_BY_CF: "Approved by CF",
    STATUS_RECEIVED_BY_CC2: "Received",
    STATUS_CONFIRMED_BY_CF: "Confirmed by CF",
    STATUS_CLOSED: "Closed",
    STATUS_CANCELLED: "Cancelled",
}
