from __future__ import annotations

STATUS_DRAFT = "draft"
STATUS_PENDING_APPROVAL = "pending_approval"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"
STATUS_IN_REWORK = "in_rework"
STATUS_CANCELLED = "cancelled"

# Two entity types so both workflows can be active (engine: one active workflow per entity_type).
ENTITY_TYPE = "capitalization_request"
ENTITY_TYPE_WITH_ENGINEERING = "capitalization_request_engineering"

CAPEX_ENTITY_TYPES = frozenset({ENTITY_TYPE, ENTITY_TYPE_WITH_ENGINEERING})

ACTION_SUBMIT = "capitalization.submit"
ACTION_SUBMIT_WITH_ENGINEERING = "capitalization.submit_with_engineering"

EDITABLE_STATUSES = frozenset({STATUS_DRAFT, STATUS_REJECTED, STATUS_IN_REWORK})
SUBMITTABLE_STATUSES = frozenset({STATUS_DRAFT, STATUS_REJECTED, STATUS_IN_REWORK})

STATUS_LABELS: dict[str, str] = {
    STATUS_DRAFT: "Draft",
    STATUS_PENDING_APPROVAL: "Pending approval",
    STATUS_APPROVED: "Approved",
    STATUS_REJECTED: "Rejected",
    STATUS_IN_REWORK: "In rework",
    STATUS_CANCELLED: "Cancelled",
}

# Role names used for CapEx user-assignment pools (must match seeded roles).
ROLE_HOD = "Department HOD"
ROLE_ENGINEERING = "Engineering"
ROLE_CENTRAL_FINANCE = "Central Finance"
