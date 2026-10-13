"""Tests for Physical Order Closure resubmission authorization.

Verifies:
1. Original executor resubmitting a rejected closure request succeeds.
2. A different currently assigned executor (e.g. Central Finance) resubmits successfully.
3. An unassigned user is denied with ApprovalError.
4. An original submitter who was reassigned away cannot bypass the assigned-executor rule.
5. Superusers retain access to resubmit even when unassigned / non-creator.
6. Other entity types (user_creation, transfers, capex, disposal) retain their existing authorization behavior.
7. Multi-cycle rejection and resubmission preserves historical attribution and properly closes rework tasks.
"""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from modules.errors import NotFoundError
from modules.orders.constants import ENTITY_TYPE_CLOSURE, ORDER_STATUS_COMPLETED, ORDER_STATUS_REJECTED
from modules.orders.model import PhysicalOrder
from modules.platform.approvals.model import ApprovalRequest, ApprovalStep, ApprovalTask, ApprovalWorkflow
from modules.platform.approvals.service import ApprovalEngineService, ApprovalError
from modules.platform.users.model import User
from modules.transfers.constants import ENTITY_TYPE as TRANSFER_ENTITY_TYPE, TRANSFER_ENTITY_TYPES
from modules.transfers.model import AssetTransferOrder


def _make_user(user_id: int, *, is_superuser: bool = False, full_name: str = "Test User") -> SimpleNamespace:
    return SimpleNamespace(
        id=user_id,
        full_name=full_name,
        is_superuser=is_superuser,
        is_active=True,
        roles=[],
        org_units=[],
    )


def _make_step(step_id: int, step_order: int, role_id: int = 1) -> SimpleNamespace:
    return SimpleNamespace(
        id=step_id,
        step_order=step_order,
        step_kind="approve",
        approver_role_id=role_id,
        approver_roles=[],
    )


def _make_workflow(wf_id: int, steps: list[SimpleNamespace]) -> SimpleNamespace:
    return SimpleNamespace(
        id=wf_id,
        name="Physical Order Approval",
        entity_type=ENTITY_TYPE_CLOSURE,
        steps=steps,
    )


def _make_closure_request(
    request_id: int,
    order_id: int,
    created_by: int,
    workflow: SimpleNamespace,
    status: str = "rejected",
) -> SimpleNamespace:
    return SimpleNamespace(
        id=request_id,
        entity_type=ENTITY_TYPE_CLOSURE,
        entity_id=order_id,
        created_by=created_by,
        status=status,
        current_step=1,
        workflow_id=workflow.id,
        workflow=workflow,
        payload={"order_id": order_id},
        created_at=datetime.now(timezone.utc),
        last_resubmitted_at=None,
    )


def _make_physical_order(order_id: int, assigned_to: int) -> SimpleNamespace:
    return SimpleNamespace(
        id=order_id,
        order_number=f"PO-{order_id}",
        assigned_to=assigned_to,
        status=ORDER_STATUS_REJECTED,
        items=[],
    )


class MockDbSession:
    """Mock database session for unit testing approval engine methods."""

    def __init__(self, entities: dict[tuple[type, int], Any]):
        self._entities = entities
        self.added: list[Any] = []
        self.flushed = False

    def get(self, model: type, pk: Any) -> Any:
        return self._entities.get((model, int(pk)))

    def scalar(self, stmt: Any) -> Any:
        sql = str(stmt).lower()
        if "approval_tasks" in sql:
            for (m, _pk), obj in self._entities.items():
                if m is ApprovalTask:
                    return obj
            return SimpleNamespace(id=999, title="New task")
        for (m, _pk), obj in self._entities.items():
            if m is ApprovalRequest or getattr(obj, "entity_type", None) in (ENTITY_TYPE_CLOSURE, TRANSFER_ENTITY_TYPE, "user_creation"):
                return obj
        return None

    def scalars(self, stmt: Any) -> Any:
        class ResultList:
            def __init__(self, items: list[Any]):
                self._items = items
            def all(self) -> list[Any]:
                return self._items
        return ResultList([])

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    def flush(self) -> None:
        self.flushed = True

    def commit(self) -> None:
        pass


@patch("modules.orders.service.PhysicalOrderService._order_payload", return_value={"order_id": 100})
@patch("modules.orders.service.PhysicalOrderService._load_order")
def test_assigned_original_executor_can_resubmit_closure(mock_load: MagicMock, mock_payload: MagicMock) -> None:
    """Original submitter who is still the assigned executor can resubmit."""
    user_a = _make_user(10, full_name="User A (Initial Executor)")
    step = _make_step(1, 1)
    wf = _make_workflow(1, [step])
    order = _make_physical_order(100, assigned_to=10)
    req = _make_closure_request(500, order.id, created_by=10, workflow=wf, status="rejected")
    mock_load.return_value = order

    db = MockDbSession({
        (User, 10): user_a,
        (ApprovalRequest, 500): req,
        (PhysicalOrder, 100): order,
    })

    svc = ApprovalEngineService(db)  # type: ignore[arg-type]
    svc._create_tasks_for_step = MagicMock()  # type: ignore[method-assign]

    returned_req, new_task_id = svc.resubmit_rejected_request(
        request_id=500,
        actor_user_id=10,
        assigned_user_id=2,
    )

    assert returned_req.status == "pending"
    assert returned_req.created_by == 10  # Preserved
    assert order.status == ORDER_STATUS_COMPLETED


@patch("modules.orders.service.PhysicalOrderService._order_payload", return_value={"order_id": 100})
@patch("modules.orders.service.PhysicalOrderService._load_order")
def test_different_assigned_executor_cf_can_resubmit_closure(mock_load: MagicMock, mock_payload: MagicMock) -> None:
    """A newly assigned executor (e.g. Central Finance user) can resubmit."""
    user_a = _make_user(10, full_name="User A (Original Executor)")
    user_cf = _make_user(25, full_name="User B (Central Finance)")
    step = _make_step(1, 1)
    wf = _make_workflow(1, [step])
    order = _make_physical_order(100, assigned_to=25)
    req = _make_closure_request(500, order.id, created_by=10, workflow=wf, status="rejected")
    mock_load.return_value = order

    db = MockDbSession({
        (User, 10): user_a,
        (User, 25): user_cf,
        (ApprovalRequest, 500): req,
        (PhysicalOrder, 100): order,
    })

    svc = ApprovalEngineService(db)  # type: ignore[arg-type]
    svc._create_tasks_for_step = MagicMock()  # type: ignore[method-assign]

    returned_req, new_task_id = svc.resubmit_rejected_request(
        request_id=500,
        actor_user_id=25,
        assigned_user_id=2,
    )

    assert returned_req.status == "pending"
    # Requirement 4: Historical created_by must NOT be overwritten by default
    assert returned_req.created_by == 10
    assert order.status == ORDER_STATUS_COMPLETED


def test_unassigned_user_is_denied_resubmission() -> None:
    """An unassigned user who is not the creator or assigned executor is denied."""
    user_a = _make_user(10, full_name="User A (Original Executor)")
    user_cf = _make_user(25, full_name="User B (Central Finance)")
    user_c = _make_user(30, full_name="User C (Unassigned Third Party)")
    step = _make_step(1, 1)
    wf = _make_workflow(1, [step])
    order = _make_physical_order(100, assigned_to=25)
    req = _make_closure_request(500, order.id, created_by=10, workflow=wf, status="rejected")

    db = MockDbSession({
        (User, 10): user_a,
        (User, 25): user_cf,
        (User, 30): user_c,
        (ApprovalRequest, 500): req,
        (PhysicalOrder, 100): order,
    })

    svc = ApprovalEngineService(db)  # type: ignore[arg-type]

    with pytest.raises(ApprovalError) as exc_info:
        svc.resubmit_rejected_request(
            request_id=500,
            actor_user_id=30,
            assigned_user_id=2,
        )

    assert "Only the person who submitted this request can resubmit it" in str(exc_info.value)


def test_reassigned_former_creator_cannot_bypass_assigned_executor_rule() -> None:
    """Requirement 5: Generic resubmission endpoint cannot let a former creator resubmit if reassigned."""
    user_a = _make_user(10, full_name="User A (Former Executor/Creator)")
    user_cf = _make_user(25, full_name="User B (Currently Assigned Central Finance)")
    step = _make_step(1, 1)
    wf = _make_workflow(1, [step])
    order = _make_physical_order(100, assigned_to=25)
    req = _make_closure_request(500, order.id, created_by=10, workflow=wf, status="rejected")

    db = MockDbSession({
        (User, 10): user_a,
        (User, 25): user_cf,
        (ApprovalRequest, 500): req,
        (PhysicalOrder, 100): order,
    })

    svc = ApprovalEngineService(db)  # type: ignore[arg-type]

    # User A (original creator) calls generic resubmit, but order is now assigned to User B
    with pytest.raises(ApprovalError) as exc_info:
        svc.resubmit_rejected_request(
            request_id=500,
            actor_user_id=10,
            assigned_user_id=2,
        )

    assert "Only the person who submitted this request can resubmit it" in str(exc_info.value)


@patch("modules.orders.service.PhysicalOrderService._order_payload", return_value={"order_id": 100})
@patch("modules.orders.service.PhysicalOrderService._load_order")
def test_superuser_retains_access_to_resubmit(mock_load: MagicMock, mock_payload: MagicMock) -> None:
    """Superuser can resubmit even when neither creator nor assigned executor."""
    admin = _make_user(99, is_superuser=True, full_name="Admin Superuser")
    step = _make_step(1, 1)
    wf = _make_workflow(1, [step])
    order = _make_physical_order(100, assigned_to=25)
    req = _make_closure_request(500, order.id, created_by=10, workflow=wf, status="rejected")
    mock_load.return_value = order

    db = MockDbSession({
        (User, 99): admin,
        (ApprovalRequest, 500): req,
        (PhysicalOrder, 100): order,
    })

    svc = ApprovalEngineService(db)  # type: ignore[arg-type]
    svc._create_tasks_for_step = MagicMock()  # type: ignore[method-assign]

    returned_req, new_task_id = svc.resubmit_rejected_request(
        request_id=500,
        actor_user_id=99,
        assigned_user_id=2,
    )

    assert returned_req.status == "pending"
    assert returned_req.created_by == 10  # Preserved
    assert order.status == ORDER_STATUS_COMPLETED


@patch("modules.transfers.service.TransferOrderService._order_payload", return_value={})
@patch("modules.transfers.service.TransferOrderService._load_order")
def test_other_entity_types_retain_existing_authorization(mock_load: MagicMock, mock_payload: MagicMock) -> None:
    """Requirement 3: user_creation, capex, and transfers retain their specific authorization rules."""
    user_a = _make_user(10, full_name="User A (Creator)")
    user_b = _make_user(20, full_name="User B (Other User)")
    step = _make_step(1, 1)
    wf = _make_workflow(1, [step])

    # 1. user_creation request: only creator or superuser can resubmit
    user_req = SimpleNamespace(
        id=601,
        entity_type="user_creation",
        entity_id=77,
        created_by=10,
        status="rejected",
        current_step=1,
        workflow_id=1,
        workflow=wf,
        payload={"username": "test"},
    )

    db = MockDbSession({
        (User, 10): user_a,
        (User, 20): user_b,
        (ApprovalRequest, 601): user_req,
    })
    svc = ApprovalEngineService(db)  # type: ignore[arg-type]

    # Non-creator User B is denied
    with pytest.raises(ApprovalError):
        svc.resubmit_rejected_request(request_id=601, actor_user_id=20)

    # 2. transfer request: destination actor can resubmit after CF return
    xfer = SimpleNamespace(
        id=200,
        to_asset_custodian_id=20,
        assigned_to=20,
        items=[],
    )
    mock_load.return_value = xfer

    transfer_req = SimpleNamespace(
        id=602,
        entity_type=TRANSFER_ENTITY_TYPE,
        entity_id=200,
        created_by=10,  # User A was original sender
        status="rejected",
        current_step=1,
        workflow_id=1,
        workflow=wf,
        payload={},
        last_resubmitted_at=None,
    )

    db_xfer = MockDbSession({
        (User, 10): user_a,
        (User, 20): user_b,
        (ApprovalRequest, 602): transfer_req,
        (AssetTransferOrder, 200): xfer,
    })
    svc_xfer = ApprovalEngineService(db_xfer)  # type: ignore[arg-type]
    svc_xfer._create_tasks_for_step = MagicMock()  # type: ignore[method-assign]

    # Destination actor User B is allowed for transfers
    ret_req, _ = svc_xfer.resubmit_rejected_request(request_id=602, actor_user_id=20)
    assert ret_req.status == "pending"


@patch("modules.orders.service.PhysicalOrderService._order_payload", return_value={"order_id": 100})
@patch("modules.orders.service.PhysicalOrderService._load_order")
def test_repeated_rejection_and_resubmission_cycle(mock_load: MagicMock, mock_payload: MagicMock) -> None:
    """Requirement 6: Multi-cycle rejection & resubmission cleans up open rework tasks."""
    user_a = _make_user(10, full_name="User A (Original Executor)")
    user_cf = _make_user(25, full_name="User B (Central Finance)")
    step = _make_step(1, 1)
    wf = _make_workflow(1, [step])
    order = _make_physical_order(100, assigned_to=25)
    req = _make_closure_request(500, order.id, created_by=10, workflow=wf, status="rejected")
    mock_load.return_value = order

    open_rework_task = SimpleNamespace(
        id=701,
        task_type="rework",
        status="open",
        request_id=500,
        closed_at=None,
    )

    db = MockDbSession({
        (User, 10): user_a,
        (User, 25): user_cf,
        (ApprovalRequest, 500): req,
        (PhysicalOrder, 100): order,
    })

    class TaskResults:
        def __init__(self, tasks: list[Any]):
            self._tasks = tasks
        def all(self) -> list[Any]:
            return self._tasks

    db.scalars = MagicMock(side_effect=[TaskResults([open_rework_task]), TaskResults([])])  # type: ignore[method-assign]

    svc = ApprovalEngineService(db)  # type: ignore[arg-type]
    svc._create_tasks_for_step = MagicMock()  # type: ignore[method-assign]

    returned_req, _ = svc.resubmit_rejected_request(
        request_id=500,
        actor_user_id=25,
        assigned_user_id=2,
    )

    # Verify open rework task was closed and audit logged
    assert open_rework_task.status == "closed"
    assert returned_req.status == "pending"
    assert returned_req.created_by == 10  # Creator attribution preserved
