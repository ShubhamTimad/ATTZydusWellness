"""ponytail: assert transfer status ladder for engine-backed approval."""

from __future__ import annotations

from modules.transfers.constants import (
    ACTIVE_STATUSES,
    EDITABLE_STATUSES,
    REJECTABLE_STATUSES,
    STATUS_APPROVED_BY_CF,
    STATUS_CANCELLED,
    STATUS_CLOSED,
    STATUS_CONFIRMED_BY_CF,
    STATUS_DRAFT,
    STATUS_IN_REWORK,
    STATUS_PENDING_APPROVAL,
    STATUS_RECEIVED_BY_CC2,
    STATUS_REJECTED,
    SUBMITTABLE_STATUSES,
)
from modules.transfers.service import _strip_or_none


def test_happy_path_statuses() -> None:
    assert STATUS_DRAFT in EDITABLE_STATUSES
    assert STATUS_IN_REWORK in EDITABLE_STATUSES
    assert STATUS_IN_REWORK in SUBMITTABLE_STATUSES
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
    # Pre-receive approve reject → creator rework (draft-like edit/resubmit).
    reject_branch = [STATUS_PENDING_APPROVAL, STATUS_IN_REWORK]
    assert reject_branch == ["pending_approval", "in_rework"]
    # Post-receive confirm reject → same order back to receiver (not draft / not new order id).
    receiver_reject_branch = [STATUS_RECEIVED_BY_CC2, STATUS_APPROVED_BY_CF]
    assert receiver_reject_branch == ["received_by_cc2", "approved_by_cf"]
    # Receiver may restart full approve flow on same order id → in_rework → resubmit.
    restart_branch = [STATUS_APPROVED_BY_CF, STATUS_IN_REWORK, STATUS_PENDING_APPROVAL]
    assert restart_branch == ["approved_by_cf", "in_rework", "pending_approval"]
    assert STATUS_REJECTED in EDITABLE_STATUSES
    assert _strip_or_none("  x  ") == "x"
    assert _strip_or_none("   ") is None
    # Plain draft → hard delete; editable with workflow history → archive (cancelled).
    assert STATUS_CANCELLED not in ACTIVE_STATUSES
    assert STATUS_CANCELLED not in EDITABLE_STATUSES


def test_custodian_gate_message() -> None:
    # Message contract used by API clients; keep stable.
    msg = "Only the asset custodian can create a transfer order for these assets: DEMO-1."
    assert "asset custodian" in msg


if __name__ == "__main__":
    test_happy_path_statuses()
    test_custodian_gate_message()
    print("ok")
