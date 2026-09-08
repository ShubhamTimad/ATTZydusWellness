from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from db.base import Base
from modules.platform.auth.model import UserSession  # noqa: F401
from modules.platform.features.model import Feature  # noqa: F401
from modules.platform.org_units.model import OrgUnit
from modules.platform.permissions.model import Permission
from modules.platform.roles.model import Role
from modules.platform.users.model import User
from modules.platform.users.schema import UserCreate, UserUpdate
from modules.platform.rbac_audit.model import RbacAuditLog
from modules.platform.users.service import DuplicatePhoneError, UserService
from sqlalchemy import select


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    with SessionLocal() as session:
        yield session


def test_create_user_assigns_role_and_org(db: Session) -> None:
    plant = OrgUnit(name="Plant A", code="PLT-A", type="PLANT")
    role = Role(name="Operator", description=None)
    db.add_all([plant, role])
    db.commit()
    db.refresh(plant)
    db.refresh(role)

    svc = UserService(db)
    user = svc.create_user(
        UserCreate(
            full_name="Alice Example",
            username="alice.example",
            phone="9876543210",
            email="alice@example.com",
            role_id=role.id,
            org_unit_id=plant.id,
        )
    )
    assert user.id > 0
    assert user.phone == "9876543210"
    assert len(user.roles) == 1
    assert user.roles[0].id == role.id
    assert len(user.org_units) == 1
    assert user.org_units[0].id == plant.id


def test_duplicate_phone_fails(db: Session) -> None:
    plant = OrgUnit(name="Plant A", code="PLT-A", type="PLANT")
    role = Role(name="Operator", description=None)
    db.add_all([plant, role])
    db.commit()
    db.refresh(plant)
    db.refresh(role)

    svc = UserService(db)
    svc.create_user(
        UserCreate(
            full_name="A",
            username="user.a",
            phone="9876543211",
            email="a@example.com",
            role_id=role.id,
            org_unit_id=plant.id,
        )
    )
    with pytest.raises(DuplicatePhoneError):
        svc.create_user(
            UserCreate(
                full_name="B",
                username="user.b",
                phone="9876543211",
                email="b@example.com",
                role_id=role.id,
                org_unit_id=plant.id,
            )
        )


def test_create_user_writes_rbac_audit(db: Session) -> None:
    plant = OrgUnit(name="Plant A", code="PLT-A", type="PLANT")
    role = Role(name="Operator", description=None)
    db.add_all([plant, role])
    db.commit()
    db.refresh(plant)
    db.refresh(role)

    svc = UserService(db)
    user = svc.create_user(
        UserCreate(
            full_name="Audit Example",
            username="audit.example",
            phone="9123456789",
            email="audit@example.com",
            role_id=role.id,
            org_unit_id=plant.id,
        ),
        actor_user_id=1,
    )
    logs = list(
        db.scalars(
            select(RbacAuditLog).where(
                RbacAuditLog.target_type == "user",
                RbacAuditLog.target_id == user.id,
            )
        ).all()
    )
    actions = {lg.action for lg in logs}
    assert actions == {"create"}


def test_invalid_phone_fails_validation() -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        UserCreate(
            full_name="Bad Phone",
            username="bad.phone",
            phone="123",
            email="bad@example.com",
            role_id=1,
            org_unit_id=1,
        )

    with pytest.raises(ValidationError):
        UserCreate(
            full_name="Landline",
            username="land.line",
            phone="5123456789",
            email="land@example.com",
            role_id=1,
            org_unit_id=1,
        )


def test_missing_role_fails(db: Session) -> None:
    plant = OrgUnit(name="Plant A", code="PLT-A", type="PLANT")
    db.add(plant)
    db.commit()
    db.refresh(plant)

    svc = UserService(db)
    from modules.errors import NotFoundError

    with pytest.raises(NotFoundError):
        svc.create_user(
            UserCreate(
                full_name="A",
                username="user.missingrole",
                phone="9876543212",
                email="missingrole@example.com",
                role_id=999,
                org_unit_id=plant.id,
            )
        )


def test_list_users_search_and_filters(db: Session) -> None:
    plant = OrgUnit(name="Plant A", code="PLT-A", type="PLANT")
    role_a = Role(name="Operator", description=None)
    role_b = Role(name="Viewer", description=None)
    db.add_all([plant, role_a, role_b])
    db.commit()
    db.refresh(plant)
    db.refresh(role_a)
    db.refresh(role_b)

    svc = UserService(db)
    alice = svc.create_user(
        UserCreate(
            full_name="Alice Example",
            username="alice.example",
            phone="9876543210",
            email="alice@example.com",
            role_id=role_a.id,
            org_unit_ids=[plant.id],
        )
    )
    bob = svc.create_user(
        UserCreate(
            full_name="Bob Other",
            username="bob.other",
            phone="9876543211",
            email="bob@example.com",
            role_id=role_b.id,
            org_unit_ids=[plant.id],
        )
    )
    bob.is_active = False
    db.commit()

    by_name = svc.list_users(search="Alice")
    assert [u.id for u in by_name] == [alice.id]

    by_email = svc.list_users(search="bob@example")
    assert [u.id for u in by_email] == [bob.id]

    active = svc.list_users(is_active=True)
    assert alice.id in {u.id for u in active}
    assert bob.id not in {u.id for u in active}

    by_role = svc.list_users(role_id=role_b.id)
    assert [u.id for u in by_role] == [bob.id]

    page1, total = svc.list_users_page(page=1, page_size=1)
    page2, _ = svc.list_users_page(page=2, page_size=1)
    assert total == 2
    assert len(page1) == 1
    assert len(page2) == 1
    assert {page1[0].id, page2[0].id} == {alice.id, bob.id}


def test_locked_account_appears_on_user_timeline_as_system(db: Session) -> None:
    from modules.platform.approvals.timeline_service import ApprovalTimelineService

    plant = OrgUnit(name="Plant A", code="PLT-A", type="PLANT")
    role = Role(name="Operator", description=None)
    db.add_all([plant, role])
    db.commit()
    db.refresh(plant)
    db.refresh(role)

    user = UserService(db).create_user(
        UserCreate(
            full_name="Locked User",
            username="locked.user",
            phone="9876543213",
            email="locked@example.com",
            role_id=role.id,
            org_unit_ids=[plant.id],
        )
    )
    locked_at = datetime(2026, 9, 8, 9, 0, tzinfo=timezone.utc)
    user.locked_at = locked_at
    db.commit()

    events = ApprovalTimelineService(db).get_entity_timeline(
        path_entity_type="user",
        entity_id=user.id,
        viewer_id=user.id,
    )
    locked = [ev for ev in events if ev.get("type") == "account_locked"]
    assert len(locked) == 1
    assert locked[0]["user"] == "System"
    assert locked[0]["timestamp"] == locked_at

    admin = UserService(db).create_user(
        UserCreate(
            full_name="Admin User",
            username="admin.user",
            phone="9876543214",
            email="admin@example.com",
            role_id=role.id,
            org_unit_ids=[plant.id],
        )
    )
    UserService(db).unlock_account(user.id, actor_user_id=admin.id)
    events = ApprovalTimelineService(db).get_entity_timeline(
        path_entity_type="user",
        entity_id=user.id,
        viewer_id=admin.id,
    )
    unlocked = [ev for ev in events if ev.get("type") == "account_unlocked"]
    assert len(unlocked) == 1
    assert unlocked[0]["user"] == "Admin User"


def test_create_and_update_user_keeps_multiple_roles(db: Session) -> None:
    plant = OrgUnit(name="Plant A", code="PLT-A", type="PLANT")
    operator = Role(name="Operator", description=None)
    viewer = Role(name="Viewer", description=None)
    db.add_all([plant, operator, viewer])
    db.commit()
    db.refresh(plant)
    db.refresh(operator)
    db.refresh(viewer)

    svc = UserService(db)
    user = svc.create_user(
        UserCreate(
            full_name="Multi Role",
            username="multi.role",
            phone="9876543299",
            email="multi@example.com",
            role_ids=[operator.id, viewer.id],
            org_unit_ids=[plant.id],
        )
    )
    assert {r.id for r in user.roles} == {operator.id, viewer.id}

    updated = svc.update_user(
        user.id,
        UserUpdate(full_name="Multi Role Updated"),
        actor_user_id=99,
    )
    assert {r.id for r in updated.roles} == {operator.id, viewer.id}

    replaced = svc.update_user(
        user.id,
        UserUpdate(role_ids=[viewer.id]),
        actor_user_id=99,
    )
    assert {r.id for r in replaced.roles} == {viewer.id}
