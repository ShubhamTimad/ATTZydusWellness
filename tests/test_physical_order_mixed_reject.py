"""Mixed approve/reject at physical-order closure review."""

from __future__ import annotations

from types import SimpleNamespace

from modules.orders.constants import (
    ITEM_STATUS_APPROVED,
    ITEM_STATUS_PENDING,
    ITEM_STATUS_REJECTED,
    ORDER_STATUS_REJECTED,
)
from modules.orders.service import PhysicalOrderService


def _item(code: str, status: str, *, scan: bool = False) -> SimpleNamespace:
    return SimpleNamespace(
        id=hash(code) % 10_000,
        asset_id=hash(code) % 10_000,
        asset_code=code,
        verification_status=status,
        rejection_reason=None,
        scan_time="t" if scan else None,
        verified_by=1 if scan else None,
    )


def test_apply_rejection_keeps_approved_lines() -> None:
    order = SimpleNamespace(
        id=1,
        status="completed",
        assigned_to=7,
        approval_request_id=None,
        rejection_reason=None,
        items=[
            _item("A1", ITEM_STATUS_APPROVED, scan=True),
            _item("A2", ITEM_STATUS_PENDING, scan=False),
            _item("A3", ITEM_STATUS_REJECTED, scan=True),
            _item("A4", ITEM_STATUS_PENDING, scan=True),
        ],
    )

    class _Svc(PhysicalOrderService):
        def __init__(self) -> None:
            self._db = SimpleNamespace(get=lambda *_a, **_k: None)

        def _latest_closure_approval_request(self, _order_id: int):  # noqa: ANN001
            return None

        def _close_pending_approval_tasks(self, _request_id: int) -> None:
            return None

        def _inventory_already_posted_for_order(self, *, asset_id: int, order_id: int) -> bool:
            _ = asset_id, order_id
            return False

        def _revert_inventory_for_rejected_scans(self, *_a, **_k) -> None:
            return None

        def _restore_executor_assignee(self, _order) -> None:  # noqa: ANN001
            return None

    svc = _Svc()
    # Bypass log_order_event side effects by stubbing it on the module during call.
    import modules.orders.service as orders_service

    original = orders_service.log_order_event
    orders_service.log_order_event = lambda *a, **k: None  # type: ignore[assignment]
    try:
        svc._apply_full_order_rejection(
            order,
            reason="Reject rest",
            actor_user_id=9,
            entity_type="physical_order_closure",
        )
    finally:
        orders_service.log_order_event = original

    assert order.status == ORDER_STATUS_REJECTED
    by_code = {i.asset_code: i for i in order.items}
    assert by_code["A1"].verification_status == ITEM_STATUS_APPROVED
    assert by_code["A1"].scan_time == "t"
    assert by_code["A2"].verification_status == ITEM_STATUS_REJECTED
    assert by_code["A2"].scan_time is None
    assert by_code["A3"].verification_status == ITEM_STATUS_REJECTED
    assert by_code["A3"].scan_time is None
    # Scanned-but-not-line-approved is rejected and must be scanned again.
    assert by_code["A4"].verification_status == ITEM_STATUS_REJECTED
    assert by_code["A4"].scan_time is None
    assert by_code["A4"].verified_by == 1
    assert by_code["A4"].rejection_reason is None
    assert order.rejection_reason == "Reject rest"


def test_reset_after_rejection_preserves_approved() -> None:
    order = SimpleNamespace(
        id=2,
        status=ORDER_STATUS_REJECTED,
        completed_at="x",
        started_at="y",
        started_by=1,
        closed_at=None,
        approval_request_id=None,
        rejection_reason="Reject rest",
        items=[
            _item("B1", ITEM_STATUS_APPROVED, scan=True),
            _item("B2", ITEM_STATUS_REJECTED, scan=False),
        ],
    )

    class _Svc(PhysicalOrderService):
        def __init__(self) -> None:
            self._db = SimpleNamespace()

        def _latest_closure_approval_request(self, _order_id: int):  # noqa: ANN001
            return None

    PhysicalOrderService._reset_order_after_full_rejection(_Svc(), order)
    by_code = {i.asset_code: i for i in order.items}
    assert by_code["B1"].verification_status == ITEM_STATUS_APPROVED
    assert by_code["B1"].scan_time == "t"
    assert by_code["B2"].verification_status == ITEM_STATUS_PENDING
    assert order.completed_at is None
    assert order.started_at is None
    assert order.rejection_reason is None


def test_rejected_verified_line_becomes_pending_scan() -> None:
    item = _item("D1", ITEM_STATUS_PENDING, scan=True)
    PhysicalOrderService._clear_item_verification(None, item, rejected=True, reason="mismatch")
    assert item.verification_status == ITEM_STATUS_REJECTED
    assert item.scan_time is None
    assert item.verified_by == 1
    assert item.rejection_reason is None


def test_order_line_counts_follow_scan_not_inventory_fallback() -> None:
    """Rejected / unscanned lines must show 0 and no date (not asset-master inventory)."""
    svc = PhysicalOrderService.__new__(PhysicalOrderService)
    svc._user_name = lambda _uid: None  # type: ignore[method-assign]
    item = SimpleNamespace(
        id=1,
        asset_id=9,
        verification_status=ITEM_STATUS_REJECTED,
        scan_time=None,
        verified_by=None,
        remarks=None,
        asset=SimpleNamespace(
            asset_code="A1",
            asset_name="Asset",
            rfid_code="R1",
            combined_asset_number=None,
            sub_no=None,
            category=None,
            asset_class_master=None,
            asset_class=None,
            inventory=SimpleNamespace(
                inventory_count=1,
                physical_count=1,
                last_verification_date="2026-09-10",
            ),
            financial=SimpleNamespace(cost_center="CC-1"),
        ),
    )
    public = PhysicalOrderService._to_item_public(svc, item)  # type: ignore[arg-type]
    assert public.physical_count == 0
    assert public.last_verification_date is None
    assert public.physically_verified is False


def test_approved_line_cannot_be_scanned_even_without_scan_time() -> None:
    """After mixed reject/restart, approved lines stay locked even if scan_time is empty."""
    from modules.errors import ConflictError

    svc = PhysicalOrderService.__new__(PhysicalOrderService)
    item = _item("E1", ITEM_STATUS_APPROVED, scan=False)
    try:
        PhysicalOrderService._assert_item_can_be_scanned(svc, item)
        raise AssertionError("approved line must not be scannable")
    except ConflictError as exc:
        assert "already approved" in str(exc).lower()

    pending = _item("E2", ITEM_STATUS_PENDING, scan=False)
    PhysicalOrderService._assert_item_can_be_scanned(svc, pending)

    scanned = _item("E3", ITEM_STATUS_PENDING, scan=True)
    try:
        PhysicalOrderService._assert_item_can_be_scanned(svc, scanned)
        raise AssertionError("already scanned line must not be scannable")
    except ConflictError as exc:
        assert "already physically verified" in str(exc).lower()
