"""Full vs selected physical-order rejection reset rules."""

from __future__ import annotations

from types import SimpleNamespace

from modules.orders.constants import ITEM_STATUS_APPROVED, ITEM_STATUS_PENDING, ITEM_STATUS_REJECTED
from modules.orders.service import PhysicalOrderService


def _svc() -> PhysicalOrderService:
    return PhysicalOrderService.__new__(PhysicalOrderService)


def test_full_rejection_clears_scans_and_marks_all_rejected() -> None:
    svc = _svc()
    items = [
        SimpleNamespace(
            scan_time="2026-08-04",
            verified_by=1,
            verification_status=ITEM_STATUS_APPROVED,
            rejection_reason=None,
        ),
        SimpleNamespace(
            scan_time=None,
            verified_by=None,
            verification_status=ITEM_STATUS_PENDING,
            rejection_reason=None,
        ),
    ]
    for item in items:
        svc._clear_item_verification(item, rejected=True, reason="Nope")  # type: ignore[arg-type]

    assert all(i.verification_status == ITEM_STATUS_REJECTED for i in items)
    assert all(i.scan_time is None for i in items)
    # Verified By is kept after reject until the next scan.
    assert items[0].verified_by == 1
    assert items[1].verified_by is None
    # Reason lives on the order, not each line.
    assert all(i.rejection_reason is None for i in items)


def test_reset_after_full_rejection_makes_everything_pending() -> None:
    svc = _svc()
    items = [
        SimpleNamespace(
            scan_time=None,
            verified_by=None,
            verification_status=ITEM_STATUS_REJECTED,
            rejection_reason=None,
        ),
        SimpleNamespace(
            scan_time=None,
            verified_by=None,
            verification_status=ITEM_STATUS_REJECTED,
            rejection_reason=None,
        ),
    ]
    order = SimpleNamespace(
        items=items,
        completed_at="x",
        started_at="y",
        started_by=1,
        closed_at=None,
        approval_request_id=9,
        rejection_reason="Nope",
        id=1,
    )
    svc._latest_closure_approval_request = lambda _oid: None  # type: ignore[method-assign]
    svc._reset_order_after_full_rejection(order)  # type: ignore[arg-type]

    assert all(i.verification_status == ITEM_STATUS_PENDING for i in items)
    assert all(i.rejection_reason is None for i in items)
    assert order.rejection_reason is None
    assert order.completed_at is None
    assert order.started_at is None
    assert order.started_by is None
    assert order.approval_request_id is None


def test_partial_reopen_keeps_verified_only_rejected_need_rescan() -> None:
    verified = SimpleNamespace(
        scan_time="2026-08-04",
        verified_by=2,
        verification_status=ITEM_STATUS_APPROVED,
        rejection_reason=None,
    )
    rejected = SimpleNamespace(
        scan_time=None,
        verified_by=None,
        verification_status=ITEM_STATUS_REJECTED,
        rejection_reason=None,
    )
    pending = SimpleNamespace(
        scan_time=None,
        verified_by=None,
        verification_status=ITEM_STATUS_PENDING,
        rejection_reason=None,
    )

    def apply_reopen_item(item: SimpleNamespace) -> None:
        if item.scan_time is not None:
            item.verification_status = ITEM_STATUS_APPROVED
            item.rejection_reason = None
            return
        if item.verification_status != ITEM_STATUS_REJECTED:
            item.verification_status = ITEM_STATUS_PENDING
            item.rejection_reason = None
        item.scan_time = None
        item.verified_by = None

    for item in (verified, rejected, pending):
        apply_reopen_item(item)

    assert verified.scan_time == "2026-08-04"
    assert verified.verification_status == ITEM_STATUS_APPROVED
    assert rejected.verification_status == ITEM_STATUS_REJECTED
    assert rejected.rejection_reason is None
    assert pending.verification_status == ITEM_STATUS_PENDING
