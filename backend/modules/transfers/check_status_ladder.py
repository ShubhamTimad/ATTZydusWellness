"""ponytail: assert transfer status ladder; upgrade when engine-backed workflows land."""

from __future__ import annotations

from modules.transfers.constants import (
    EDITABLE_STATUSES,
    STATUS_APPROVED_BY_CF,
    STATUS_ASSIGNED_TO_CF,
    STATUS_CLOSED,
    STATUS_DRAFT,
    STATUS_RECEIVED_BY_CC2,
    STATUS_REJECTED,
)


def test_happy_path_statuses() -> None:
    assert STATUS_DRAFT in EDITABLE_STATUSES
    assert STATUS_REJECTED in EDITABLE_STATUSES
    path = [
        STATUS_DRAFT,
        STATUS_ASSIGNED_TO_CF,
        STATUS_APPROVED_BY_CF,
        STATUS_RECEIVED_BY_CC2,
        STATUS_CLOSED,
    ]
    assert path == [
        "draft",
        "assigned_to_cf",
        "approved_by_cf",
        "received_by_cc2",
        "closed",
    ]
    reject_branch = [STATUS_ASSIGNED_TO_CF, STATUS_REJECTED, STATUS_ASSIGNED_TO_CF]
    assert reject_branch[1] == "rejected"


if __name__ == "__main__":
    test_happy_path_statuses()
    print("ok")
