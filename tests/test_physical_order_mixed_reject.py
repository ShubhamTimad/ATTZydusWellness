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
        asset_code=code,
        verification_status=status,
        rejection_reason="no" if status == ITEM_STATUS_REJECTED else None,
        scan_time="t" if scan else None,
        verified_by=1 if scan else None,
    )


def test_apply_rejection_keeps_approved_lines() -> None:
    order = SimpleNamespace(
        id=1,
        status="completed",
        assigned_to=7,
        approval_request_id=None,
        items=[
            _item("A1", ITEM_STATUS_APPROVED, scan=True),
            _item("A2", ITEM_STATUS_PENDING, scan=True),
            _item("A3", ITEM_STATUS_REJECTED, scan=True),
        ],
    )

    class _Svc(PhysicalOrderService):
        def __init__(self) -> None:
            self._db = SimpleNamespace(get=lambda *_a, **_k: None)

        def _latest_closure_approval_request(self, _order_id: int):  # noqa: ANN001
            return None

        def _close_pending_approval_tasks(self, _request_id: int) -> None:
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


def test_reset_after_rejection_preserves_approved() -> None:
    order = SimpleNamespace(
        id=2,
        status=ORDER_STATUS_REJECTED,
        completed_at="x",
        started_at="y",
        started_by=1,
        closed_at=None,
        approval_request_id=None,
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
