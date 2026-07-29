from __future__ import annotations

STATUS_DRAFT = "draft"
STATUS_PENDING_APPROVAL = "pending_approval"
STATUS_REJECTED = "rejected"
STATUS_IN_REWORK = "in_rework"
# Fully approved — waiting for the Store-selected receiver to take the assets.
STATUS_PENDING_RECEIPT = "pending_receipt"
STATUS_PENDING_CF_CLOSE = "pending_cf_close"
STATUS_CLOSED = "closed"
STATUS_CANCELLED = "cancelled"

# Two entity types so both workflows can be active (engine: one active workflow per entity_type).
ENTITY_TYPE = "disposal_order"
ENTITY_TYPE_WITH_ENGINEERING = "disposal_order_engineering"

DISPOSAL_ENTITY_TYPES = frozenset({ENTITY_TYPE, ENTITY_TYPE_WITH_ENGINEERING})

ACTION_SUBMIT = "disposal.submit"
ACTION_SUBMIT_WITH_ENGINEERING = "disposal.submit_with_engineering"

EDITABLE_STATUSES = frozenset({STATUS_DRAFT, STATUS_REJECTED, STATUS_IN_REWORK})
SUBMITTABLE_STATUSES = frozenset({STATUS_DRAFT, STATUS_REJECTED, STATUS_IN_REWORK})

# Role names used for assignee pools (must match seeded roles). The *next approver* role always
# comes from the configured workflow steps; these levels only drive the user picker.
ROLE_HOD = "Department HOD"
ROLE_ENGINEERING = "Engineering"
ROLE_CENTRAL_FINANCE = "Central Finance"
ROLE_CFM = "CFM"
ROLE_MD = "MD"
ROLE_STORE_PERSON = "Store Person"
ROLE_COST_CENTER_USER = "Cost Center User"

ASSIGNEE_LEVEL_ROLES: dict[str, str] = {
    "hod": ROLE_HOD,
    "engineering": ROLE_ENGINEERING,
    "central_finance": ROLE_CENTRAL_FINANCE,
    "cfm": ROLE_CFM,
    "md": ROLE_MD,
    "store": ROLE_STORE_PERSON,
    "cost_center": ROLE_COST_CENTER_USER,
    # Receiver pool after Store Person's final approval (Cost Center User).
    "receiver": ROLE_COST_CENTER_USER,
    # Alias kept for older clients / seeds.
    "scrapyard": ROLE_COST_CENTER_USER,
}

# Reverse map for the approval panel (one level per role name).
ROLE_TO_ASSIGNEE_LEVEL: dict[str, str] = {
    ROLE_HOD: "hod",
    ROLE_ENGINEERING: "engineering",
    ROLE_CENTRAL_FINANCE: "central_finance",
    ROLE_CFM: "cfm",
    ROLE_MD: "md",
    ROLE_STORE_PERSON: "store",
    ROLE_COST_CENTER_USER: "cost_center",
}

# Level the UI uses when Store Person picks the receiver on final approval.
RECEIVER_ASSIGNEE_LEVEL = "receiver"
SCRAPYARD_ASSIGNEE_LEVEL = RECEIVER_ASSIGNEE_LEVEL  # backward-compatible alias

STATUS_LABELS: dict[str, str] = {
    STATUS_DRAFT: "Draft",
    STATUS_PENDING_APPROVAL: "Pending approval",
    STATUS_REJECTED: "Rejected",
    STATUS_IN_REWORK: "In rework",
    STATUS_PENDING_RECEIPT: "Pending receive",
    STATUS_PENDING_CF_CLOSE: "Pending CF approval",
    STATUS_CLOSED: "Closed",
    STATUS_CANCELLED: "Archived",
}
