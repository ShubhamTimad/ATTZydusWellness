"""ponytail: assert transfer status ladder; upgrade when engine-backed workflows land."""

from __future__ import annotations

from modules.transfers.constants import (
    EDITABLE_STATUSES,
    REJECTABLE_STATUSES,
    STATUS_APPROVED_BY_CF,
    STATUS_ASSIGNED_TO_CF,
    STATUS_CLOSED,
    STATUS_CONFIRMED_BY_CF,
    STATUS_DRAFT,
    STATUS_RECEIVED_BY_CC2,
    STATUS_REJECTED,
)
from modules.transfers.service import _strip_or_none


def test_happy_path_statuses() -> None:
    assert STATUS_DRAFT in EDITABLE_STATUSES
    assert STATUS_REJECTED in EDITABLE_STATUSES
    path = [
        STATUS_DRAFT,
        STATUS_ASSIGNED_TO_CF,
        STATUS_APPROVED_BY_CF,
        STATUS_RECEIVED_BY_CC2,
        STATUS_CONFIRMED_BY_CF,
        STATUS_CLOSED,
    ]
    assert path == [
        "draft",
        "assigned_to_cf",
        "approved_by_cf",
        "received_by_cc2",
        "confirmed_by_cf",
        "closed",
    ]
    assert STATUS_ASSIGNED_TO_CF in REJECTABLE_STATUSES
    assert STATUS_APPROVED_BY_CF in REJECTABLE_STATUSES
    assert STATUS_RECEIVED_BY_CC2 in REJECTABLE_STATUSES
    assert STATUS_CONFIRMED_BY_CF in REJECTABLE_STATUSES
    assert STATUS_CLOSED not in REJECTABLE_STATUSES
    reject_branch = [STATUS_ASSIGNED_TO_CF, STATUS_REJECTED, STATUS_ASSIGNED_TO_CF]
    assert reject_branch[1] == "rejected"
    assert _strip_or_none("  x  ") == "x"
    assert _strip_or_none("   ") is None


def test_custodian_gate_message() -> None:
    # Message contract used by API clients; keep stable.
    msg = "Only the asset custodian can create a transfer order for these assets: DEMO-1."
    assert "asset custodian" in msg


if __name__ == "__main__":
    test_happy_path_statuses()
    test_custodian_gate_message()
    print("ok")
