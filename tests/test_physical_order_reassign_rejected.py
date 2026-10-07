"""Rejecter may reassign a fully rejected physical order (with reason); the lock rules stay the same."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from modules.errors import ConflictError
from modules.orders import service as order_service
from modules.orders.progress import _audit_detail
from modules.orders.service import PhysicalOrderService


def _rejected_order() -> SimpleNamespace:
    return SimpleNamespace(
        id=5,
        order_number="PVO-5",
        status="rejected",
        plant_id=1,
        assigned_to=10,
        assigned_by=None,
        assigned_at=datetime.now(timezone.utc),
        started_at=datetime.now(timezone.utc),
        completed_at=datetime.now(timezone.utc),
    )


@pytest.fixture
def svc(monkeypatch: pytest.MonkeyPatch):
    svc = PhysicalOrderService(MagicMock())
    order = _rejected_order()
    logged: list[dict] = []
    monkeypatch.setattr(svc, "_load_order", lambda *_a, **_k: order)
    monkeypatch.setattr(svc, "_rejected_by", lambda _o: 99)
    monkeypatch.setattr(svc, "_assert_valid_executor", lambda uid, **_k: SimpleNamespace(full_name="New Exec"))
    monkeypatch.setattr(svc, "_cost_center_ids_for_order", lambda _o: [])
    monkeypatch.setattr(svc, "_user_name", lambda _uid: "Old Exec")
    monkeypatch.setattr(svc, "_notify_assigned", lambda _o: None)
    monkeypatch.setattr(svc, "get_order", lambda *_a, **_k: order)
    monkeypatch.setattr(order_service, "log_order_event", lambda _db, **kw: logged.append(kw))
    svc.order, svc.logged = order, logged  # type: ignore[attr-defined]
    return svc


def test_rejecter_reassigns_with_reason(svc) -> None:
    svc.reassign_order(5, assigned_to=11, actor_user_id=99, reason="On leave")
    assert svc.order.assigned_to == 11 and svc.order.status == "rejected"
    assert svc.logged[-1]["new_value"]["reason"] == "On leave"


def test_only_rejecter_and_reason_required(svc) -> None:
    with pytest.raises(ConflictError, match="Only the user who rejected"):
        svc.reassign_order(5, assigned_to=11, actor_user_id=7, reason="x")
    with pytest.raises(ConflictError, match="reason is required"):
        svc.reassign_order(5, assigned_to=11, actor_user_id=99, reason="  ")


def test_restart_keeps_approved_locked_and_reopens_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    svc = PhysicalOrderService(MagicMock())
    monkeypatch.setattr(svc, "_latest_closure_approval_request", lambda _oid: None)
    approved = SimpleNamespace(verification_status="approved", scan_time=1, rejection_reason=None)
    rejected = SimpleNamespace(verification_status="rejected", scan_time=1, rejection_reason="bad")
    order = SimpleNamespace(id=5, items=[approved, rejected])
    svc._reset_order_after_full_rejection(order)  # type: ignore[arg-type]
    assert approved.verification_status == "approved" and approved.scan_time == 1
    assert rejected.verification_status == "pending" and rejected.scan_time is None


def test_audit_shows_reassign_reason() -> None:
    text = _audit_detail(
        "reassigned",
        {"assigned_to_name": "Old Exec"},
        {"assigned_to": 11, "assigned_to_name": "New Exec", "reason": "On leave"},
    )
    assert text == "Old Exec → New Exec · Reason: On leave"
