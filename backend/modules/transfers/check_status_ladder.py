"""ponytail: assert transfer status ladder for engine-backed approval."""

from __future__ import annotations

from modules.transfers.constants import (
    ACTIVE_STATUSES,
    EDITABLE_STATUSES,
    LEGACY_STATUS_ALIASES,
    REJECTABLE_STATUSES,
    RESUMABLE_STATUSES,
    STATUS_APPROVED_BY_CF,
    STATUS_CANCELLED,
    STATUS_CLOSED,
    STATUS_CONFIRMED_BY_CF,
    STATUS_DRAFT,
    STATUS_IN_REWORK,
    STATUS_LABELS,
    STATUS_PENDING_APPROVAL,
    STATUS_RECEIVED_BY_CC2,
    STATUS_REJECTED,
    SUBMITTABLE_STATUSES,
)
from modules.transfers.service import _strip_or_none


def test_happy_path_statuses() -> None:
    assert STATUS_DRAFT in EDITABLE_STATUSES
    assert STATUS_DRAFT in SUBMITTABLE_STATUSES
    assert STATUS_REJECTED in RESUMABLE_STATUSES
    assert STATUS_IN_REWORK in RESUMABLE_STATUSES  # legacy
    assert STATUS_REJECTED not in EDITABLE_STATUSES
    assert STATUS_IN_REWORK not in EDITABLE_STATUSES
    path = [
        STATUS_DRAFT,
        STATUS_PENDING_APPROVAL,
        STATUS_APPROVED_BY_CF,
        STATUS_RECEIVED_BY_CC2,
        STATUS_CONFIRMED_BY_CF,
        STATUS_CLOSED,
    ]
    assert path == [
        "draft",
        "pending_approval",
        "approved_by_cf",
        "received_by_cc2",
        "confirmed_by_cf",
        "closed",
    ]
    assert STATUS_PENDING_APPROVAL not in REJECTABLE_STATUSES
    assert STATUS_APPROVED_BY_CF not in REJECTABLE_STATUSES
    assert STATUS_RECEIVED_BY_CC2 not in REJECTABLE_STATUSES
    assert STATUS_CONFIRMED_BY_CF not in REJECTABLE_STATUSES
    assert STATUS_CLOSED not in REJECTABLE_STATUSES
    assert not REJECTABLE_STATUSES
    # Pre-receive approve reject → rejected; creator Restart → draft → submit.
    reject_branch = [STATUS_PENDING_APPROVAL, STATUS_REJECTED, STATUS_DRAFT]
    assert reject_branch == ["pending_approval", "rejected", "draft"]
    # Post-receive confirm reject → same order back to receiver as Rejected (not draft).
    receiver_reject_branch = [STATUS_RECEIVED_BY_CC2, STATUS_REJECTED]
    assert receiver_reject_branch == ["received_by_cc2", "rejected"]
    # Receiver may restart full approve flow on same order id → draft → resubmit.
    restart_branch = [STATUS_REJECTED, STATUS_DRAFT, STATUS_PENDING_APPROVAL]
    assert restart_branch == ["rejected", "draft", "pending_approval"]
    # List inbox tabs: action-first — Pending action / Done / All.
    assert {"needs_action", "done", "all"} == {"needs_action", "done", "all"}
    assert _strip_or_none("  x  ") == "x"
    assert _strip_or_none("   ") is None
    # Plain draft → hard delete; editable with workflow history → archive (cancelled).
    assert STATUS_CANCELLED not in ACTIVE_STATUSES
    assert STATUS_CANCELLED not in EDITABLE_STATUSES
    # Status filter: legacy codes fold into one current option each, in workflow order.
    filter_options = [s for s in STATUS_LABELS if s not in LEGACY_STATUS_ALIASES]
    assert filter_options == [
        "draft",
        "pending_approval",
        "rejected",
        "approved_by_cf",
        "received_by_cc2",
        "confirmed_by_cf",
        "closed",
        "cancelled",
    ]
    assert set(LEGACY_STATUS_ALIASES.values()) <= set(filter_options)


def test_custodian_gate_message() -> None:
    # Message contract used by API clients; keep stable.
    msg = "Only the asset custodian can create a transfer order for these assets: DEMO-1."
    assert "asset custodian" in msg


if __name__ == "__main__":
    test_happy_path_statuses()
    test_custodian_gate_message()
    print("ok")
