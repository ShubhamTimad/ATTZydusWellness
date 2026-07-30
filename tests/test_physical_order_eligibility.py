"""Physical verification order eligibility: approved + RFID only."""

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
