"""Physical verification order eligibility and executor cost-center scope."""

from __future__ import annotations


def can_create_physical_verification_order(
    *,
    approval_status: str | None,
    lifecycle_status: str | None,
    rfid_code: str | None,
) -> bool:
    approval = (approval_status or "").strip().lower()
    if approval != "approved":
        return False
    lifecycle = (lifecycle_status or "").strip().lower()
    if lifecycle and lifecycle != "active":
        return False
    return bool((rfid_code or "").strip())


def user_covers_cost_centers(*, assigned_cost_center_ids: set[int], cost_center_ids: list[int]) -> bool:
    if not cost_center_ids:
        return True
    if not assigned_cost_center_ids:
        return True
    assigned = {int(x) for x in assigned_cost_center_ids}
    return all(int(cc) in assigned for cc in cost_center_ids)


def user_in_cost_center_scope(*, assigned_cost_center_ids: set[int], cost_center_id: int) -> bool:
    """Plant-only users (no CCs) cover every CC; otherwise must include cost_center_id.

    Mirrors modules.orders.service.user_in_cost_center_scope.
    """
    return user_covers_cost_centers(
        assigned_cost_center_ids=assigned_cost_center_ids,
        cost_center_ids=[int(cost_center_id)],
    )


def test_requires_approved_and_rfid() -> None:
    assert can_create_physical_verification_order(
        approval_status="approved",
        lifecycle_status="active",
        rfid_code="RFID-1",
    )
    assert not can_create_physical_verification_order(
        approval_status="draft",
        lifecycle_status="active",
        rfid_code="RFID-1",
    )
    assert not can_create_physical_verification_order(
        approval_status="approved",
        lifecycle_status="active",
        rfid_code="",
    )
    assert not can_create_physical_verification_order(
        approval_status="approved",
        lifecycle_status="deactivated",
        rfid_code="RFID-1",
    )


def test_executor_cost_center_scope() -> None:
    assert user_in_cost_center_scope(assigned_cost_center_ids=set(), cost_center_id=10)
    assert user_in_cost_center_scope(assigned_cost_center_ids={10, 20}, cost_center_id=10)
    assert not user_in_cost_center_scope(assigned_cost_center_ids={10, 20}, cost_center_id=99)


def test_executor_must_cover_every_selected_cost_center() -> None:
    assert user_covers_cost_centers(assigned_cost_center_ids=set(), cost_center_ids=[10, 20])
    assert user_covers_cost_centers(assigned_cost_center_ids={10, 20, 30}, cost_center_ids=[10, 20])
    assert not user_covers_cost_centers(assigned_cost_center_ids={10}, cost_center_ids=[10, 20])
    assert not user_covers_cost_centers(assigned_cost_center_ids={10, 30}, cost_center_ids=[10, 20])


def test_open_order_statuses_block_new_physical_order() -> None:
    from modules.orders.constants import (
        ACTIVE_ORDER_STATUSES,
        ORDER_CONFLICT_BLOCK_STATUSES,
        ORDER_STATUS_ASSIGNED,
        ORDER_STATUS_CANCELLED,
        ORDER_STATUS_CLOSED,
        ORDER_STATUS_DRAFT,
        ORDER_STATUS_IN_PROGRESS,
        ORDER_STATUS_REJECTED,
    )

    assert ORDER_CONFLICT_BLOCK_STATUSES == ACTIVE_ORDER_STATUSES
    for status in (ORDER_STATUS_DRAFT, ORDER_STATUS_ASSIGNED, ORDER_STATUS_IN_PROGRESS):
        assert status in ORDER_CONFLICT_BLOCK_STATUSES
    for status in (ORDER_STATUS_CLOSED, ORDER_STATUS_CANCELLED, ORDER_STATUS_REJECTED):
        assert status not in ORDER_CONFLICT_BLOCK_STATUSES
