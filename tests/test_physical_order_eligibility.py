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


def user_in_cost_center_scope(*, assigned_cost_center_ids: set[int], cost_center_id: int) -> bool:
    """Plant-only users (no CCs) cover every CC; otherwise must include cost_center_id.

    Mirrors modules.orders.service.user_in_cost_center_scope.
    """
    if not assigned_cost_center_ids:
        return True
    return int(cost_center_id) in assigned_cost_center_ids


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
