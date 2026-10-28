"""User creation: draft → submit with next approver → last approve activates + welcome mail."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from db.base import Base
from modules.errors import ConflictError
from modules.platform.auth.model import UserSession  # noqa: F401
from modules.platform.features.model import Feature  # noqa: F401
from modules.platform.org_units.model import OrgUnit
from modules.platform.rbac_audit.model import RbacAuditLog  # noqa: F401
from modules.platform.roles.model import Role
from modules.platform.users.schema import UserCreate
from modules.platform.users.service import UserService


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    with SessionLocal() as session:
        yield session


def _seed(db: Session) -> tuple[Role, OrgUnit]:
    plant = OrgUnit(name="Plant A", code="PLT-A", type="PLANT")
    role = Role(name="Operator", description=None)
    db.add_all([plant, role])
    db.commit()
    db.refresh(plant)
    db.refresh(role)
    return role, plant


def test_create_user_is_always_draft(db: Session) -> None:
    role, plant = _seed(db)
    user = UserService(db).create_user(
        UserCreate(
            full_name="Draft User",
            username="draft.user",
            phone="9876543210",
            email="draft@example.com",
            role_id=role.id,
            org_unit_ids=[plant.id],
            is_active=True,  # ignored — create is always draft
        ),
        actor_user_id=1,
    )
    assert user.is_active is False
    assert UserService(db).user_approval_status(user) == "draft"
    assert UserService(db).can_submit_user_for_approval(user) is True


def test_submit_requires_assignee_and_starts_request(db: Session) -> None:
    role, plant = _seed(db)
    svc = UserService(db)
    user = svc.create_user(
        UserCreate(
            full_name="Pending User",
            username="pending.user",
            phone="9876543211",
            email="pending@example.com",
            role_id=role.id,
            org_unit_ids=[plant.id],
        ),
        actor_user_id=1,
    )
    wf = SimpleNamespace(id=9, steps=[SimpleNamespace(step_order=1, approver_role_id=role.id)])
    with patch("modules.platform.approvals.assignment_service.get_workflow_for_action", return_value=wf):
        with pytest.raises(ConflictError, match="Select an approver"):
            svc.submit_for_approval(user.id, actor_user_id=1, assignee_user_id=None)

    engine = MagicMock()
    with patch("modules.platform.approvals.assignment_service.get_workflow_for_action", return_value=wf):
        with patch("modules.platform.users.service.ApprovalEngineService", return_value=engine):
            result = svc.submit_for_approval(user.id, actor_user_id=1, assignee_user_id=42)
    assert result["status"] == "submitted"
    engine.create_request_for_entity.assert_called_once()
    kwargs = engine.create_request_for_entity.call_args.kwargs
    assert kwargs["entity_type"] == "user_creation"
    assert kwargs["assigned_user_id"] == 42
    assert kwargs["payload"].get("temp_password")


def test_submit_without_workflow_activates_and_mails(db: Session) -> None:
    role, plant = _seed(db)
    svc = UserService(db)
    user = svc.create_user(
        UserCreate(
            full_name="Instant User",
            username="instant.user",
            phone="9876543212",
            email="instant@example.com",
            role_id=role.id,
            org_unit_ids=[plant.id],
        ),
        actor_user_id=1,
    )
    with patch("modules.platform.approvals.assignment_service.get_workflow_for_action", return_value=None):
        with patch("modules.platform.users.service.enqueue_trigger_events") as mail:
            with patch("modules.platform.users.service.maybe_send_mfa_setup_for_user"):
                result = svc.submit_for_approval(user.id, actor_user_id=1, assignee_user_id=None)
    assert result["status"] == "activated"
    db.refresh(user)
    assert user.is_active is True
    mail.assert_called_once()
    assert mail.call_args.args[0][0][0] == "USER_CREATED"
    assert mail.call_args.args[0][0][1]["temp_password"]


def test_users_create_resolves_user_creation_workflow() -> None:
    from modules.platform.approvals import assignment_service as asn

    db = MagicMock()
    with patch.object(asn, "resolve_registered_action_code", return_value="users.create"):
        with patch.object(asn, "select") as _select:
            db.scalar.return_value = None  # no mapping row
            with patch("modules.platform.approvals.service.ApprovalWorkflowService") as WfSvc:
                WfSvc.return_value.get_active_workflow_for_entity.return_value = "WF"
                assert asn.get_workflow_for_action(db, "users.create") == "WF"
                WfSvc.return_value.get_active_workflow_for_entity.assert_called_with("user_creation")
