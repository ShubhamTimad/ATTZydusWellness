from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from modules.platform.org_units.model import OrgUnit
from modules.platform.org_units.schema import OrgUnitCreate, OrgUnitUpdate
from modules.rbac_safety import assert_org_unit_not_assigned_to_any_user


class NotFoundError(Exception):
    def __init__(self, entity: str, entity_id: int) -> None:
        self.entity = entity
        self.entity_id = entity_id
        super().__init__(f"{entity} {entity_id} not found")


class DuplicateOrgUnitCodeError(Exception):
    pass


class OrgUnitService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def list_org_units(self, *, org_type: str | None = None) -> list[OrgUnit]:
        stmt = select(OrgUnit).order_by(OrgUnit.name.asc())
        if org_type:
            stmt = stmt.where(OrgUnit.type == org_type)
        return list(self._db.scalars(stmt).all())

    def get_org_unit(self, org_unit_id: int) -> OrgUnit:
        row = self._db.get(OrgUnit, org_unit_id)
        if row is None:
            raise NotFoundError("OrgUnit", org_unit_id)
        return row

    def create_org_unit(self, data: OrgUnitCreate) -> OrgUnit:
        row = OrgUnit(
            name=data.name.strip(),
            code=data.code,
            type=data.type.strip().upper(),
            parent_id=data.parent_id,
        )
        self._db.add(row)
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            raise DuplicateOrgUnitCodeError from exc
        self._db.refresh(row)
        return row

    def update_org_unit(self, org_unit_id: int, data: OrgUnitUpdate) -> OrgUnit:
        row = self.get_org_unit(org_unit_id)
        row.name = data.name.strip()
        row.code = data.code
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            raise DuplicateOrgUnitCodeError from exc
        self._db.refresh(row)
        return row

    def delete_org_unit(self, org_unit_id: int) -> None:
        assert_org_unit_not_assigned_to_any_user(self._db, org_unit_id)
        row = self.get_org_unit(org_unit_id)
        self._db.delete(row)
        try:
            self._db.commit()
        except IntegrityError as exc:
            self._db.rollback()
            raise DuplicateOrgUnitCodeError from exc
