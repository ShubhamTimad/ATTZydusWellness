from __future__ import annotations

STATUS_DRAFT = "draft"
STATUS_PENDING_APPROVAL = "pending_approval"
# Legacy status from pre-engine transfers; treat like pending_approval when present.
STATUS_ASSIGNED_TO_CF = "assigned_to_cf"
STATUS_REJECTED = "rejected"
STATUS_IN_REWORK = "in_rework"
STATUS_APPROVED_BY_CF = "approved_by_cf"  # approved → awaiting destination custodian receive
STATUS_RECEIVED_BY_CC2 = "received_by_cc2"
STATUS_CONFIRMED_BY_CF = "confirmed_by_cf"
STATUS_CLOSED = "closed"
STATUS_CANCELLED = "cancelled"

ENTITY_TYPE = "transfer_order"
TRANSFER_ENTITY_TYPES = frozenset({ENTITY_TYPE})

ACTION_SUBMIT = "transfer.submit"

EDITABLE_STATUSES = frozenset({STATUS_DRAFT, STATUS_REJECTED, STATUS_IN_REWORK})
SUBMITTABLE_STATUSES = frozenset({STATUS_DRAFT, STATUS_REJECTED, STATUS_IN_REWORK})
PENDING_APPROVAL_STATUSES = frozenset({STATUS_PENDING_APPROVAL, STATUS_ASSIGNED_TO_CF})

# Post-approval stages are not rejectable — once approved, receive/confirm/close only.
REJECTABLE_STATUSES: frozenset[str] = frozenset()
ACTIVE_STATUSES = frozenset(
    {
        STATUS_DRAFT,
        STATUS_PENDING_APPROVAL,
        STATUS_ASSIGNED_TO_CF,
        STATUS_REJECTED,
        STATUS_IN_REWORK,
        STATUS_APPROVED_BY_CF,
        STATUS_RECEIVED_BY_CC2,
        STATUS_CONFIRMED_BY_CF,
    }
)

# Role names must match seeded org roles. Workflow steps point at role IDs — rename in admin is OK.
ROLE_HOD = "Department HOD"
ROLE_COST_CENTER_USER = "Cost Center User"
ROLE_CENTRAL_FINANCE = "Central Finance"

ASSIGNEE_LEVEL_ROLES: dict[str, str] = {
    "hod": ROLE_HOD,
    "cost_center": ROLE_COST_CENTER_USER,
    "central_finance": ROLE_CENTRAL_FINANCE,
}

ROLE_TO_ASSIGNEE_LEVEL: dict[str, str] = {
    ROLE_HOD: "hod",
    ROLE_COST_CENTER_USER: "cost_center",
    ROLE_CENTRAL_FINANCE: "central_finance",
}


def transfer_needs_next_assignee(
    *,
    current_kind: str,
    next_kind: str,
    current_role_id: int | None,
    next_role_id: int | None,
) -> bool:
    """Whether completing the current step requires picking a user for the next step.

    Derived from workflow step kinds + role ids (not role display names).
    Next step is close with the same role → same person continues, no picker.
    ``current_kind`` is accepted for call-site symmetry; the rule keys off next kind + roles.
    """
    _ = current_kind
    if next_role_id is None:
        return False
    if (
        next_kind == "close"
        and current_role_id is not None
        and int(current_role_id) == int(next_role_id)
    ):
        return False
    return True

STATUS_LABELS: dict[str, str] = {
    STATUS_DRAFT: "Draft",
    STATUS_PENDING_APPROVAL: "Pending approval",
    STATUS_ASSIGNED_TO_CF: "Pending approval",
    STATUS_REJECTED: "Rejected",
    STATUS_IN_REWORK: "In rework",
    STATUS_APPROVED_BY_CF: "Approved — pending receive",
    STATUS_RECEIVED_BY_CC2: "Received",
    STATUS_CONFIRMED_BY_CF: "Confirmed by CF",
    STATUS_CLOSED: "Closed",
    STATUS_CANCELLED: "Cancelled",
}
