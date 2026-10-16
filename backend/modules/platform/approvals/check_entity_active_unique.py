"""ponytail: approval request uniqueness allows repeat reject after resume."""

from __future__ import annotations

from sqlalchemy import Index

from modules.platform.approvals.model import ApprovalRequest


def test_active_request_unique_is_partial() -> None:
    indexes = {idx.name: idx for idx in ApprovalRequest.__table__.indexes}
    assert "uq_approval_requests_entity_active" in indexes
    idx: Index = indexes["uq_approval_requests_entity_active"]
    assert idx.unique is True
    # Legacy full (entity, status) unique must not remain — blocks 2nd reject.
    constraint_names = {c.name for c in ApprovalRequest.__table__.constraints}
    assert "uq_approval_requests_entity_status" not in constraint_names


if __name__ == "__main__":
    test_active_request_unique_is_partial()
    print("ok")
