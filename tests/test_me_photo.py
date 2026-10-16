"""Signed-in users get their own profile photo for the navbar avatar without users.view."""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from core.auth import CurrentUser
from db.base import Base
from modules.platform.auth.model import UserSession  # noqa: F401
from modules.platform.auth.routes import my_photo
from modules.platform.auth.service import AuthService
from modules.platform.features.model import Feature  # noqa: F401
from modules.platform.org_units.model import OrgUnit
from modules.platform.rbac_audit.model import RbacAuditLog  # noqa: F401
from modules.platform.roles.model import Role
from modules.platform.users.schema import UserCreate
from modules.platform.users.service import UserService

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    with SessionLocal() as session:
        yield session


def test_me_photo_follows_upload(db: Session) -> None:
    plant = OrgUnit(name="Plant A", code="PLT-A", type="PLANT")
    role = Role(name="Operator", description=None)
    db.add_all([plant, role])
    db.commit()
    svc = UserService(db)
    user = svc.create_user(
        UserCreate(
            full_name="Rashi Magar",
            username="rashi",
            phone="9876543210",
            email="rashi@example.com",
            role_id=role.id,
            org_unit_ids=[plant.id],
        )
    )
    current = CurrentUser(subject=str(user.id), permissions=frozenset(), claims={})

    assert AuthService(db).get_me_public(user.id).has_photo is False
    with pytest.raises(HTTPException) as exc:
        my_photo(current=current, db=db)
    assert exc.value.status_code == 404

    svc.set_photo(user.id, PNG)
    assert AuthService(db).get_me_public(user.id).has_photo is True
    res = my_photo(current=current, db=db)
    assert res.body == PNG
    assert res.media_type == "image/png"
